# Blender 5.0 — Python API Breaking Changes

Reference notes for migrating add-ons/extensions to Blender 5.0.

Source: [Blender 5.0 Python API release notes](https://developer.blender.org/docs/release_notes/5.0/python_api/)

---

## 1. Runtime-defined property storage is no longer accessible

Properties defined via `bpy.props` are no longer stored in the same container as
user-defined [Custom Properties](https://docs.blender.org/manual/en/5.0/files/custom_properties.html).
They can no longer be reached through dict-like syntax.

```python
bpy.context.scene['cycles']  # ✗ no longer gives access to Cycles' scene settings
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

- [Commit 469f54f484](https://projects.blender.org/blender/blender/commit/469f54f484)
- [Design task #141042](https://projects.blender.org/blender/blender/issues/141042)

---

## 3. Migration cheat sheet

### Resetting a property

| Before | After |
| --- | --- |
| `del obj['cycles']` or `obj.property_unset('cycles')` | `obj.property_unset('cycles')` |

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
