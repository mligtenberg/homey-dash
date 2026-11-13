import json

import pytest

import stt


@pytest.fixture
def mgr(tmp_path, monkeypatch):
    monkeypatch.setattr(stt, "DATA", tmp_path)
    monkeypatch.setattr(stt, "SETTINGS", tmp_path / "settings.json")
    monkeypatch.setenv("HF_HUB_CACHE", str(tmp_path / "hub"))
    from huggingface_hub import constants
    monkeypatch.setattr(constants, "HF_HUB_CACHE", str(tmp_path / "hub"))
    return stt.Manager(default="small")


def fake_download(tmp_path, opt):
    snap = tmp_path / "hub" / ("models--" + opt.repo.replace("/", "--")) / "snapshots" / "abc"
    snap.mkdir(parents=True)
    (snap / "model.bin").write_bytes(b"x")
    (snap / "config.json").write_text("{}")


def row(m, id):
    return next(r for r in m.state()["options"] if r["id"] == id)


def test_default_and_listing(mgr):
    s = mgr.state()
    assert s["selected"] == "small"
    assert [o["id"] for o in s["options"]][:2] == ["tiny", "base"]
    assert "voxtral" not in [o["id"] for o in s["options"]]
    assert "large-v3" not in [o["id"] for o in s["options"]]
    assert not row(mgr, "small")["installed"]


def test_select_needs_the_model(mgr, tmp_path):
    with pytest.raises(stt.Unavailable):
        mgr.select("base")
    fake_download(tmp_path, mgr.option("base"))
    mgr.select("base")
    assert mgr.selected == "base"
    assert json.loads((tmp_path / "settings.json").read_text()) == {"model": "base"}
    assert stt.Manager(default="small").selected == "base"  # survives a restart


def test_unknown_model(mgr):
    with pytest.raises(KeyError):
        mgr.select("nope")


def test_incomplete_download_is_not_installed(mgr, tmp_path):
    opt = mgr.option("tiny")
    snap = tmp_path / "hub" / ("models--" + opt.repo.replace("/", "--")) / "snapshots" / "abc"
    snap.mkdir(parents=True)
    (snap / "config.json").write_text("{}")
    assert not mgr.installed(opt)


def test_custom_voice_model(tmp_path, monkeypatch):
    monkeypatch.setattr(stt, "SETTINGS", tmp_path / "settings.json")
    m = stt.Manager(default="org/some-ct2-model")
    assert row(m, "org/some-ct2-model")["selected"]


def test_delete_refuses_the_one_in_use(mgr, tmp_path):
    fake_download(tmp_path, mgr.option("small"))
    mgr.select("small")
    with pytest.raises(stt.Unavailable):
        mgr.delete("small")
    fake_download(tmp_path, mgr.option("base"))
    mgr.delete("base")
    assert not mgr.installed(mgr.option("base"))


def test_download_runs_one_at_a_time_and_reports_errors(mgr, monkeypatch):
    import huggingface_hub

    def boom(*a, **kw):
        raise OSError("no network")

    monkeypatch.setattr(huggingface_hub, "snapshot_download", boom)
    mgr.download("base")
    for t in __import__("threading").enumerate():
        if t.name == "download-base":
            t.join(5)
    r = row(mgr, "base")
    assert not r["downloading"] and "no network" in r["error"]


def test_download_counts_bytes_when_huggingface_disables_its_bars(mgr, monkeypatch):
    # In a container huggingface turns its progress bars off; the byte counter must still work.
    import huggingface_hub
    from huggingface_hub.utils import disable_progress_bars

    def fetch(repo, allow_patterns, tqdm_class):
        bar = tqdm_class(total=100, unit="B")
        bar.update(100)
        bar.close()

    disable_progress_bars()
    monkeypatch.setattr(huggingface_hub, "snapshot_download", fetch)
    mgr.download("base")
    for t in __import__("threading").enumerate():
        if t.name == "download-base":
            t.join(5)
    assert row(mgr, "base")["error"] is None


def test_api(mgr, monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    import app as voice_app

    monkeypatch.setattr(voice_app, "models", mgr)
    c = TestClient(voice_app.app)
    assert c.get("/api/stt").json()["selected"] == "small"
    assert c.post("/api/stt/select", json={"id": "base"}).status_code == 409
    assert c.post("/api/stt/select", json={"id": "zzz"}).status_code == 404
    fake_download(tmp_path, mgr.option("base"))
    assert c.post("/api/stt/select", json={"id": "base"}).json()["selected"] == "base"
    assert c.delete("/api/stt/base").status_code == 409
