# Blender 5.0 — Python API Breaking Changes

Reference notes for migrating add-ons/extensions to Blender 5.0.

Source: [Blender 5.0 Python API release notes](https://developer.blender.org/docs/release_notes/5.0/python_api/)

> All code and behaviour in this document was **executed and verified against real
> Blender 5.0.1** (`bpy` module, headless). Verified facts are marked ✅ and include
> the actual observed output. See [Appendix: verification](#appendix-verification).

---

## 1. Runtime-defined property storage is no longer accessible

Properties defined via `bpy.props` are no longer stored in the same container as
user-defined [Custom Properties](https://docs.blender.org/manual/en/5.0/files/custom_properties.html).
They can no longer be reached through dict-like syntax.

```python
bpy.context.scene['cycles']  # ✗ no longer gives access to Cycles' scene settings
```

✅ **Verified on 5.0.1** — the access does not merely return `None`, it raises:

```python
bpy.types.Scene.mp = bpy.props.IntProperty(default=3)
sc = bpy.context.scene
sc.mp = 7

sc['mp']   # KeyError: 'bpy_struct[key]: key "mp" not found'
sc.mp      # 7          <- attribute access still works

sc['cp'] = 42   # user Custom Properties are unaffected
sc['cp']        # 42
```

- [Commit 7276b2009a](https://projects.blender.org/blender/blender/commit/7276b2009a8819619263a1b897389662307b0ee0)
- [Design task #123232](https://projects.blender.org/blender/blender/issues/123232)

---

## 2. New `get_transform` / `set_transform` accessors

New `bpy.props` callbacks that let you edit a value while still using the default
(IDProperty-based) storage system. They exist because directly touching the
underlying IDProperty storage of a `bpy.props` property is now fully unsupported —
older code that used `get`/`set` purely to transform a value before storing it in
the IDProperty is no longer valid.

Rules of thumb:

- Read-only properties should be declared with the new `options` flag `READ_ONLY`.
- Use `get`/`set` **only** when storing data outside the default system.
  - `get` without `set` → property is read-only (unchanged behaviour).
  - `set` without `get` → now an **error**.
  - A property should typically not need both `get` and `get_transform`
    (or both `set` and `set_transform`).
- `get_transform`/`set_transform` must produce values matching the constraints of
  the property definition: same/compatible type, within range, matching dimensions
  for `Vector` properties, etc.

> Initial benchmarks: the "transform" variants are several times faster than real
> `get`/`set`.

### ✅ Actual callback signatures (verified on 5.0.1)

The release notes do not state the signatures. They are **not** the same as
`get`/`set`, and getting them wrong is a hard registration error:

```
TypeError: get_transform keyword: expected a function taking 3 arguments, not 2
TypeError: set_transform keyword: expected a function taking 4 arguments, not 3
```

```python
def get_transform(self, value, is_set):        # 3 args
    """value = what is stored; return what the user sees."""
    return value * 2

def set_transform(self, value, old_value, is_set):   # 4 args
    """value = incoming assignment, old_value = currently stored.
    Return what should actually be stored."""
    return value + 1

bpy.types.Scene.tp = bpy.props.IntProperty(
    get_transform=get_transform,
    set_transform=set_transform,
    default=0,
)
```

Observed round-trip:

```python
sc.tp = 10                              # set_transform -> stores 11
sc.bl_system_properties_get()["tp"]     # 11   (actual stored value)
sc.tp                                   # 22   (get_transform: 11 * 2)
```

The third/fourth argument `is_set` is a bool telling you whether the property is
currently set in storage (observed `False` during the first `set_transform`,
`True` on the following `get_transform`).

Vector properties work the same way, per-vector not per-component:

```python
bpy.types.Scene.vp = bpy.props.FloatVectorProperty(
    size=3,
    get_transform=lambda self, value, is_set: [x * 2 for x in value],
    set_transform=lambda self, value, old, is_set: [x + 1 for x in value],
)
sc.vp = (1, 2, 3)
list(sc.vp)   # [4.0, 6.0, 8.0]
```

### ✅ `READ_ONLY` and `set` without `get` (verified)

```python
bpy.types.Scene.ro = bpy.props.IntProperty(options={'READ_ONLY'}, default=5)
sc.ro       # 5
sc.ro = 9   # AttributeError: bpy_struct: attribute "ro" from "Scene" is read-only
```

```python
bpy.props.IntProperty(set=lambda s, v: None)
# ValueError: The `set` callback is defined without a matching `get` function,
# this is not supported. `set_transform` should probably be used instead?
```

- [Commit 469f54f484](https://projects.blender.org/blender/blender/commit/469f54f484)
- [Design task #141042](https://projects.blender.org/blender/blender/issues/141042)

---

## 3. Migration cheat sheet

### Resetting a property

| Before | After |
| --- | --- |
| `del obj['cycles']` or `obj.property_unset('cycles')` | `obj.property_unset('cycles')` |

✅ Verified: after `sc.mp = 7; sc.property_unset('mp')`, `sc.mp` returns the
declared default `3`. `del sc['mp']` now raises `KeyError`.

### Copying

Before (highly unsafe — no validation of the assigned dict-like data):

```python
obj['cycles'] = another_obj['cycles']
```

After: WIP. The intent is to
[copy content recursively](https://projects.blender.org/Mets/blender_studio_utils/src/branch/main/properties.py#L74),
and possibly improve handling at the `GroupProperty` level itself.

### Versioning

Before:

```python
old_prop = obj['old_data']['old_prop']
obj.new_data.new_prop = old_prop
```

After — this is the main expected use case for `bl_system_properties_get`:

```python
sys_props = obj.bl_system_properties_get()
old_prop = sys_props['old_data']['old_prop']
obj.new_data.new_prop = old_prop
```

✅ **Verified on 5.0.1** — this is the escape hatch that still reads
`bpy.props` values as raw data:

```python
sc.mp = 7
sc['mp']                              # KeyError
sc.bl_system_properties_get()['mp']   # 7
type(sc.bl_system_properties_get())   # PropertyGroup (an IDPropertyGroup view)
```

Note: `bl_system_properties_get` is **not** discoverable on `bpy.types.ID`
(`[m for m in dir(bpy.types.ID) if 'system_propert' in m]` returns `[]`), but it
does exist and work on the instances.

### Bypassing property handling

Before:

```python
# Get without triggering the getter callback
my_var = obj.my_addon['my_prop']

# Set without triggering setter or update callbacks
obj.my_addon['my_prop'] = 1
```

After: **no longer directly supported.** Restructure the code so you don't rely on
it. Alternatives: define a flag your getter/setter checks against
([example](https://projects.blender.org/blender/blender/issues/141042#issuecomment-1683440)),
or force a custom data storage (e.g. custom properties) with explicit custom
getters and setters.

> Bypassing the RNA property system is **strongly discouraged**. Do so at your own risk.

---

## 4. IDProperties duplication

Types whose IDProperties storage was actually split in two — all `ID` types, plus
`ViewLayer`, `Bone`, `EditBone`, `BoneCollection`, `PoseBone`, `Strip` — get their
"custom data" IDProperties duplicated into the system ones when loading blendfiles
from 4.5 and earlier, so no data is lost during versioning.

This is usually fine, but can cause side effects: unexpected ID usages that never
get cleared, or significant performance issues when there was already an
unreasonable amount of IDProperties and it is now doubled.

Generic "IDProperties cleanup" tooling is planned for Blender 5.1. In the meantime,
add-ons can clean up their own data via the deprecated ID property paths:

```python
# Cleanup Object.my_addon data storage from pre-Blender 5.0 blendfiles:
for ob in bpy.data.objects:
    if 'my_addon' in ob:
        del ob['my_addon']
```

---

## Quick audit checklist

- [ ] No `id_data['my_addon']` style access to `bpy.props`-defined properties.
- [ ] Any `set` callback has a matching `get` callback.
- [ ] Read-only properties use `options={'READ_ONLY'}` instead of a bare `get`.
- [ ] Value-massaging `get`/`set` pairs converted to `get_transform`/`set_transform`.
- [ ] Versioning code reads legacy data through `bl_system_properties_get()`.
- [ ] One-time cleanup of duplicated pre-5.0 IDProperties for the add-on's keys.

---

## Appendix: verification

Everything marked ✅ above was produced by running the snippets inside a real
Blender 5.0.1 interpreter (`pip install bpy==5.0.1`, headless, Python 3.11).

Reproduce with:

```bash
python3 -m venv .venv
.venv/bin/pip install bpy==5.0.1
.venv/bin/python verify_blender50.py
```

Summary of observed results:

| Claim | Result on 5.0.1 |
| --- | --- |
| dict access to a `bpy.props` property | `KeyError: 'bpy_struct[key]: key "mp" not found'` |
| attribute access to same property | works (`7`) |
| user Custom Property via dict | still works (`42`) |
| `bl_system_properties_get()['mp']` | `7` — returns a `PropertyGroup` view |
| `get_transform` signature | `(self, value, is_set)` — 3 args |
| `set_transform` signature | `(self, value, old_value, is_set)` — 4 args |
| transform round-trip `sc.tp = 10` | stored `11`, read back `22` |
| vector transform `sc.vp = (1,2,3)` | `[4.0, 6.0, 8.0]` |
| `options={'READ_ONLY'}` write | `AttributeError: ... is read-only` |
| `set` without `get` | `ValueError: The set callback is defined without a matching get function...` |
| `property_unset()` | restores declared default |
