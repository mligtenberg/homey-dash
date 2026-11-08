# FormField

A labeled input in Management: a text input, a select or a group of checkboxes.

- Use `.hd-field`, with an `.hd-field__label` label tied to the control by `for`/`id`, and then `.hd-input`, `.hd-select`, or `.hd-check` labels.
- Field labels name the thing, not the action: "Target", "Label", "Show and control".
- The target is picked with a [TargetPicker](TargetPicker.md), not a select.
- Put a hint under the control in `.hd-hint`, tied to it with `aria-describedby`. When the field is invalid, its error replaces the hint as `.hd-error.hd-small`.
