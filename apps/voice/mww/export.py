"""A microWakeWord .tflite -> the .bin the C runtime loads: per op (stem conv, depthwise, pointwise, dense) its int8 weights and requantisation constants,
with the wiring that the order of ops does not tell (which channels a depthwise branch reads, and where its output goes), plus the sigmoid table."""
import sys, math, struct, numpy as np
from tflite import Model
from tflite.BuiltinOperator import BuiltinOperator

m = Model.GetRootAsModel(open(sys.argv[1], 'rb').read(), 0)
g = m.Subgraphs(0)

def const(i):
    t = g.Tensors(i); d = m.Buffers(t.Buffer()).DataAsNumpy()
    dt = {9: np.int8, 2: np.int32, 3: np.uint8}[t.Type()]
    return np.frombuffer(d.tobytes(), dt).reshape(t.ShapeAsNumpy())
def q(i):
    qq = g.Tensors(i).Quantization()
    return qq.ScaleAsNumpy().astype(np.float64), qq.ZeroPointAsNumpy().astype(np.int64)

def quantize_multiplier(d):
    if d == 0: return 0, 0
    frac, shift = math.frexp(d)
    f = int(round(frac * (1 << 31)))   # std::round: half away from zero; frac > 0 here
    if f == (1 << 31): f //= 2; shift += 1
    if shift < -31: return 0, 0
    return f, shift

ops = []   # (kind, input, filter, bias, output)
names = {v: k for k, v in vars(BuiltinOperator).items() if not k.startswith('_')}
for i in range(g.OperatorsLength()):
    op = g.Operators(i); n = names[m.OperatorCodes(op.OpcodeIndex()).BuiltinCode()]
    if n in ('CONV_2D', 'DEPTHWISE_CONV_2D', 'FULLY_CONNECTED'):
        a, b, c = op.InputsAsNumpy(); ops.append((n, a, b, c, op.OutputsAsNumpy()[0]))
    if n == 'LOGISTIC':
        lg = (op.InputsAsNumpy()[0], op.OutputsAsNumpy()[0])

# --- wiring: which channels a depthwise reads (via SPLIT_V) and where its output lands (via CONCATENATION) ---
def _i32(i):
    d = m.Buffers(g.Tensors(i).Buffer()); return np.frombuffer(d.DataAsNumpy().tobytes(), np.int32).tolist()
producer, concats, split_pos = {}, [], {}
for oi in range(g.OperatorsLength()):
    op_ = g.Operators(oi); nm = names[m.OperatorCodes(op_.OpcodeIndex()).BuiltinCode()]
    ins_, outs_ = [int(x) for x in op_.InputsAsNumpy()], [int(x) for x in op_.OutputsAsNumpy()]
    for t_ in outs_: producer[t_] = (nm, ins_)
    if nm == 'CONCATENATION': concats.append(ins_)
    if nm == 'SPLIT_V':
        off = 0
        for t_, sz in zip(outs_, _i32(ins_[1])): split_pos[t_] = off; off += sz
def channel_in(t_):          # first channel of the stage's row that this tensor holds
    while t_ in producer and producer[t_][0] == 'STRIDED_SLICE': t_ = producer[t_][1][0]
    return split_pos.get(t_, 0)
def channel_out(t_):         # where this tensor sits in the concatenation that joins the branches
    for ins_ in concats:
        if t_ in ins_ and any(producer.get(x, ('',))[0] == 'DEPTHWISE_CONV_2D' for x in ins_):
            return sum(int(g.Tensors(x).ShapeAsNumpy()[-1]) for x in ins_[:ins_.index(t_)])
    return 0

out = bytearray()
def i32(*v): out.extend(struct.pack('<%di' % len(v), *v))
sin0, zin0 = q(0)
i32(len(ops), int(zin0[0])); out.extend(struct.pack('<d', float(sin0[0])))

# kinds: 0 stem conv, 1 depthwise, 2 pointwise conv, 3 dense.  K = kernel rows, AUX = input channels (conv/dense) or first channel (dw),
# R = rows of ring-buffer state this op starts a streaming stage with (-1: none).
kinds = []
i = 0
while i < len(ops):
    if i == 0: kinds.append((0, None)); i += 1; continue
    if ops[i][0] == 'DEPTHWISE_CONV_2D':
        j = i
        while ops[j][0] == 'DEPTHWISE_CONV_2D': j += 1
        group = list(range(i, j)); rmax = max(const(ops[k][2]).shape[1] for k in group) - 1
        for k in group:
            kinds.append((1, (channel_in(int(ops[k][1])), channel_out(int(ops[k][4])), rmax if k == i else -1)))
        i = j
    elif ops[i][0] == 'CONV_2D': kinds.append((2, None)); i += 1
    else: kinds.append((3, None)); i += 1

cols = None
for (kind, a, f, b, o), (kk, extra) in zip(ops, kinds):
    sin, zin = q(a); sf, _ = q(f); sout, zout = q(o)
    w = const(f); bias = const(b)
    cout = int(w.shape[0] if kk != 1 else w.shape[3])
    sf = np.broadcast_to(sf, (cout,))
    mult, shift = zip(*[quantize_multiplier(float(sin[0]) * float(sf[c]) / float(sout[0])) for c in range(cout)])
    relu = g.Tensors(o).Name().decode().find('Relu') >= 0
    amin = int(zout[0]) if relu else -128   # TFLite: ReLU clamps at the quantised zero
    aux2 = 0
    if kk == 0: k, aux, R = int(w.shape[1]), int(w.shape[3]), int(w.shape[1]) - 3
    elif kk == 1: k, (aux, aux2, R) = int(w.shape[1]), extra
    elif kk == 2: k, aux, R = 1, int(w.shape[3]), -1
    else: aux = cols; k = int(w.shape[1]) // aux; R = k - 1
    cols = cout if kk != 3 else cols
    wb = w.astype(np.int8).tobytes()
    i32(kk, int(zin[0]), int(zout[0]), amin, 127, cout, len(wb), k, aux, R, aux2)
    out.extend(wb); out.extend(b'\0' * (-len(wb) % 4))
    i32(*bias.astype(np.int32).tolist()); i32(*mult); i32(*shift)
    print(['stem', 'dw', 'pw', 'dense'][kk], tuple(w.shape), 'K', k, 'aux', aux, 'R', R, 'out@', aux2, 'cout', cout)

# the sigmoid as a table over the 256 int8 inputs (what TFLite builds for int8)
sin, zin = q(lg[0]); sout, zout = q(lg[1])
lut = []
for v in range(-128, 128):
    x = float(sin[0]) * (v - int(zin[0]))
    r = int(round(1.0 / (1.0 + math.exp(-x)) / float(sout[0]))) + int(zout[0])
    lut.append(max(-128, min(127, r)))
out.extend(np.array(lut, np.int8).tobytes())
open(sys.argv[2], 'wb').write(out)
print('input scale %r zp %d' % (float(sin0[0]), int(zin0[0])), 'bytes', len(out))
