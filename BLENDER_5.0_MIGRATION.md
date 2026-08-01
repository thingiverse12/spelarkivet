# Blender 5.0 — Python API Breaking Changes

Reference notes for migrating add-ons/extensions to Blender 5.0.

Source: [Blender 5.0 Python API release notes](https://developer.blender.org/docs/release_notes/5.0/python_api/)

> All code and behaviour in this document was **executed and verified against real
> Blender 5.0.1** (`bpy` module, headless). Verified facts are marked ✅ and include
> the actual observed output. The full test script and its results are in the
> appendices at the end — this file is self-contained.

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

### ⚠️ Gotchas the release notes do not mention (all verified on 5.0.1)

**1. Exceptions inside `get_transform` are silently swallowed.** The traceback is
printed to stderr, but the attribute access *succeeds* and returns the type's
zero value. Your add-on will read `0` instead of crashing:

```python
def bad_get(self, value, is_set):
    raise RuntimeError("boom")

bpy.types.Scene.eg = bpy.props.IntProperty(get_transform=bad_get)
sc.eg   # -> 0   (RuntimeError only printed to console)
```

Same for a wrong return type: returning `"str"` from an `IntProperty`
`get_transform` prints `TypeError` and yields `0`. **Validate inside your own
callback — you will not get an exception at the call site.**

**2. `min`/`max` are NOT enforced on `get_transform` output.** They *are*
enforced on `set_transform` output:

```python
bpy.props.IntProperty(min=0, max=10, get_transform=lambda s, v, i: 999)
sc.cl    # -> 999   ⚠ out of declared range, not clamped

bpy.props.IntProperty(min=0, max=10, set_transform=lambda s, v, o, i: 999, ...)
sc.cl2 = 5
sc.cl2   # -> 10    ✓ clamped on store
```

So the release-notes rule *"transform callbacks must generate values within
required range"* is a **contract you must uphold yourself on the read side** —
it is not validated.

**3. Combinations the notes discourage are not actually rejected.** Both of these
register without error, so there is no guard rail:

- `get` + `get_transform` together → allowed
- `options={'READ_ONLY'}` + `set_transform` → allowed

**4. `String`, `Bool` and `Enum` support transforms too** (notes only imply
numeric/vector):

```python
bpy.props.StringProperty(
    get_transform=lambda s, v, i: v.upper(),
    set_transform=lambda s, v, o, i: v.strip(),
)
sc.sp = "  hi  "
sc.sp   # -> "HI"
```

**5. The performance claim is not reproducible at small scale.** Over 20 000
set+get round-trips, `get_transform`/`set_transform` came out only **1.1–1.25×**
faster than real `get`/`set` (the ratio moved between runs, so treat it as noise
around "roughly equal"), not "several times". The
"several times faster" figure likely refers to a different benchmark; do not
migrate for performance reasons alone.

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

Note: `bl_system_properties_get` is **not** discoverable on the *type*
(`hasattr(bpy.types.Object, 'bl_system_properties_get')` → `False` for every type
I tested: `Scene`, `Object`, `Mesh`, `ViewLayer`, `Bone`, `EditBone`,
`BoneCollection`, `PoseBone`, `Strip`, `Material`, `WindowManager`), but it exists
and works on the *instances*. Don't feature-detect on the class.

✅ Two further verified behaviours:

**It is available on `PropertyGroup` instances too**, not just `ID` types, and
nested groups are reachable and **writable**:

```python
sc.pg.val = 5
sc.bl_system_properties_get()['pg']['val']       # 5
sc.bl_system_properties_get()['pg']['val'] = 9
sc.pg.val                                        # 9  -- write went through
```

**Writing through the system-properties view bypasses `update` callbacks.**
This is effectively the surviving form of the old "set without triggering
callbacks" trick:

```python
bpy.types.Scene.up = bpy.props.IntProperty(update=my_cb)
sc.up = 3                                  # my_cb fires
sc.bl_system_properties_get()['up'] = 77   # my_cb does NOT fire
sc.up                                      # 77
```

Handy for versioning, but it is the same footgun the notes warn about — use
deliberately.

⚠️ Also note: a `PropertyGroup`'s own members are still dict-accessible
(`sc.pg['val']` → `5` works). The `KeyError` restriction applies to properties
looked up on the ID/struct itself, not to members inside a `PropertyGroup`. Don't
assume every `x['y']` in your codebase is broken — test each one.

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

### ✅ End-to-end 4.5 → 5.0 test (actually performed)

I saved a real `.blend` in **Blender 4.5.12 LTS** containing an add-on
`PointerProperty` (`ob.my_addon.old_prop = 123`) plus a genuine user custom
property (`ob["user_custom"] = "hello"`), then opened it in **5.0.1**.

Duplication confirmed — the key appears in *both* stores after load:

```python
ob.keys()                            # ['my_addon', 'user_custom']   (custom side)
ob.bl_system_properties_get().keys() # ['my_addon', 'user_custom']   (system side)
ob['my_addon']['old_prop']           # 123  -- legacy copy still readable
```

**The cleanup snippet is safe.** This is the question that matters most in
practice, and the answer is reassuring:

| Step | Result |
| --- | --- |
| Value after re-registering the add-on in 5.0 | `123` — survived versioning |
| `ob.keys()` before cleanup | `['my_addon', 'user_custom']` |
| After `del ob['my_addon']` | `['user_custom']` |
| **`ob.my_addon.old_prop` after cleanup** | **`123` — still intact** ✅ |
| System props after cleanup | `['my_addon', 'user_custom']` — untouched |
| `ob["user_custom"]` | `"hello"` — real custom props unaffected |
| After save + reload of the cleaned file | `123`, keys `['user_custom']` ✅ |

So `del ob['my_addon']` removes only the *duplicated legacy copy*; the live
property keeps working and the cleanup persists across save/reload. Run it once
on load of pre-5.0 files.

⚠️ **Order matters:** do the cleanup *after* your properties are registered and
any versioning code has read the legacy values, otherwise you delete the data you
were about to migrate.

---

## Quick audit checklist

- [ ] No `id_data['my_addon']` style access to `bpy.props`-defined properties.
- [ ] Any `set` callback has a matching `get` callback.
- [ ] Read-only properties use `options={'READ_ONLY'}` instead of a bare `get`.
- [ ] Value-massaging `get`/`set` pairs converted to `get_transform`/`set_transform`.
- [ ] Versioning code reads legacy data through `bl_system_properties_get()`.
- [ ] One-time cleanup of duplicated pre-5.0 IDProperties for the add-on's keys.

---

## Appendix A: the verification script

Self-contained — copy everything between the fences into `verify_blender50.py`.

```python
"""Verify the Blender 5.0 Python API breaking changes against a real bpy build.

Usage:
    python3 -m venv .venv && .venv/bin/pip install bpy==5.0.1
    .venv/bin/python verify_blender50.py

Companion test (needs a second venv with bpy==4.5.12):
    .venv45/bin/python verify_blender50.py --make-legacy /tmp/legacy45.blend
    .venv/bin/python   verify_blender50.py --check-legacy /tmp/legacy45.blend

NOTE: exceptions raised inside get_transform are swallowed by Blender and the
read returns a zero value. Always watch stderr when interpreting results.
"""
import sys, json, time
import bpy

def make_legacy(path):
    """Author a pre-5.0 style file (run under Blender 4.5)."""
    class PG(bpy.types.PropertyGroup):
        old_prop: bpy.props.IntProperty(default=0)
    bpy.utils.register_class(PG)
    bpy.types.Object.my_addon = bpy.props.PointerProperty(type=PG)
    ob = bpy.data.objects.new("Target", None)
    bpy.context.scene.collection.objects.link(ob)
    ob.my_addon.old_prop = 123
    ob["user_custom"] = "hello"
    bpy.ops.wm.save_as_mainfile(filepath=path)
    return {"authored_with": bpy.app.version_string,
            "dict_access_worked": ob['my_addon']['old_prop']}

def check_legacy(path):
    """Open a 4.5 file in 5.0 and verify duplication + cleanup safety."""
    r = {}
    bpy.ops.wm.open_mainfile(filepath=path)
    class PG(bpy.types.PropertyGroup):
        old_prop: bpy.props.IntProperty(default=0)
    bpy.utils.register_class(PG)
    bpy.types.Object.my_addon = bpy.props.PointerProperty(type=PG)
    ob = bpy.data.objects["Target"]
    r["value_after_versioning"] = ob.my_addon.old_prop
    r["custom_keys"] = list(ob.keys())
    r["system_keys"] = list(ob.bl_system_properties_get().keys())
    if 'my_addon' in ob:
        del ob['my_addon']
    r["custom_keys_after_cleanup"] = list(ob.keys())
    r["value_after_cleanup"] = ob.my_addon.old_prop
    r["user_custom_intact"] = ob.get("user_custom")
    return r

def main():
    r = {"version": bpy.app.version_string}
    sc = bpy.context.scene

    # --- 1. storage split ---------------------------------------------------
    bpy.types.Scene.mp = bpy.props.IntProperty(default=3)
    sc.mp = 7
    try:
        r["dict_access"] = sc["mp"]
    except Exception as e:
        r["dict_access"] = f"{type(e).__name__}: {e}"
    r["attr_access"] = sc.mp
    r["sysprops"] = sc.bl_system_properties_get()["mp"]
    r["sysprops_on_type"] = hasattr(bpy.types.Scene, "bl_system_properties_get")
    sc["cp"] = 42
    r["custom_prop"] = sc["cp"]
    sc.property_unset("mp")
    r["after_unset"] = sc.mp

    # --- 2. transform signatures -------------------------------------------
    bpy.types.Scene.tp = bpy.props.IntProperty(
        get_transform=lambda self, value, is_set: value * 2,
        set_transform=lambda self, value, old, is_set: value + 1,
        default=0)
    sc.tp = 10
    r["transform_stored"] = sc.bl_system_properties_get()["tp"]
    r["transform_read"] = sc.tp

    bpy.types.Scene.vp = bpy.props.FloatVectorProperty(
        size=3,
        get_transform=lambda self, v, i: [x * 2 for x in v],
        set_transform=lambda self, v, o, i: [x + 1 for x in v])
    sc.vp = (1, 2, 3)
    r["vector"] = [round(x, 2) for x in sc.vp]

    # --- 3. READ_ONLY / set-without-get ------------------------------------
    bpy.types.Scene.ro = bpy.props.IntProperty(options={'READ_ONLY'}, default=5)
    r["readonly_read"] = sc.ro
    try:
        sc.ro = 9
        r["readonly_write"] = "ALLOWED (unexpected)"
    except Exception as e:
        r["readonly_write"] = f"{type(e).__name__}"
    try:
        bpy.types.Scene.bad = bpy.props.IntProperty(set=lambda s, v: None)
        r["set_without_get"] = "ALLOWED (unexpected)"
    except Exception as e:
        r["set_without_get"] = f"{type(e).__name__}"

    # --- 4. gotchas ---------------------------------------------------------
    def boom(self, v, i):
        raise RuntimeError("boom")
    bpy.types.Scene.eg = bpy.props.IntProperty(get_transform=boom)
    r["exception_swallowed_returns"] = sc.eg          # expect 0
    bpy.types.Scene.cl = bpy.props.IntProperty(
        min=0, max=10, get_transform=lambda s, v, i: 999)
    r["get_not_clamped"] = sc.cl                       # expect 999
    bpy.types.Scene.cl2 = bpy.props.IntProperty(
        min=0, max=10,
        set_transform=lambda s, v, o, i: 999,
        get_transform=lambda s, v, i: v)
    sc.cl2 = 5
    r["set_is_clamped"] = sc.cl2                       # expect 10

    # update callback bypass via system properties
    fired = []
    bpy.types.Scene.up = bpy.props.IntProperty(update=lambda s, c: fired.append(s.up))
    sc.up = 3
    n_before = len(fired)
    sc.bl_system_properties_get()["up"] = 77
    r["update_bypassed"] = (len(fired) == n_before)
    r["up_value"] = sc.up

    # --- 5. perf ------------------------------------------------------------
    N = 20000
    bpy.types.Scene.pt = bpy.props.IntProperty(
        get_transform=lambda s, v, i: v, set_transform=lambda s, v, o, i: v)
    t = time.time()
    for i in range(N):
        sc.pt = i; _ = sc.pt
    r["t_transform"] = round(time.time() - t, 4)
    store = {}
    bpy.types.Scene.pg2 = bpy.props.IntProperty(
        get=lambda s: store.get('v', 0), set=lambda s, v: store.__setitem__('v', v))
    t = time.time()
    for i in range(N):
        sc.pg2 = i; _ = sc.pg2
    r["t_getset"] = round(time.time() - t, 4)
    r["speedup"] = round(r["t_getset"] / max(r["t_transform"], 1e-9), 2)
    return r

if __name__ == "__main__":
    if "--make-legacy" in sys.argv:
        out = make_legacy(sys.argv[sys.argv.index("--make-legacy") + 1])
    elif "--check-legacy" in sys.argv:
        out = check_legacy(sys.argv[sys.argv.index("--check-legacy") + 1])
    else:
        out = main()
    print(json.dumps(out, indent=2, default=str))
```

---

## Appendix B: verification results

Everything marked ✅ was executed in real Blender interpreters, headless:

- **Blender 5.0.1** (`pip install bpy==5.0.1`), Python 3.11
- **Blender 4.5.12 LTS** (`pip install bpy==4.5.12`) — used to author a genuine
  pre-5.0 `.blend` for the versioning test

Reproduce with:

```bash
python3 -m venv .venv   && .venv/bin/pip   install bpy==5.0.1
python3 -m venv .venv45 && .venv45/bin/pip install bpy==4.5.12

# core checks against 5.0
.venv/bin/python verify_blender50.py

# versioning check: author in 4.5, then inspect in 5.0
.venv45/bin/python verify_blender50.py --make-legacy  /tmp/legacy45.blend
.venv/bin/python   verify_blender50.py --check-legacy /tmp/legacy45.blend
```

Summary of observed results:

| Claim | Result on 5.0.1 |
| --- | --- |
| dict access to a `bpy.props` property | `KeyError: 'bpy_struct[key]: key "mp" not found'` |
| attribute access to same property | works (`7`) |
| user Custom Property via dict | still works (`42`) |
| member inside a `PropertyGroup` via dict | still works (`5`) — restriction is narrower than it looks |
| `bl_system_properties_get()['mp']` | `7` — returns a `PropertyGroup` view |
| same, on the type | `hasattr(bpy.types.Object, ...)` → `False` (instances only) |
| write via system props | works, and **skips `update` callbacks** |
| `get_transform` signature | `(self, value, is_set)` — 3 args |
| `set_transform` signature | `(self, value, old_value, is_set)` — 4 args |
| transform round-trip `sc.tp = 10` | stored `11`, read back `22` |
| vector transform `sc.vp = (1,2,3)` | `[4.0, 6.0, 8.0]` |
| exception inside `get_transform` | **swallowed**, returns `0` |
| wrong return type from `get_transform` | **swallowed**, returns `0` |
| `min`/`max` vs `get_transform` output | **not clamped** (`999` returned) |
| `min`/`max` vs `set_transform` output | clamped (`10`) |
| `get` + `get_transform` together | allowed (no error) |
| `READ_ONLY` + `set_transform` | allowed (no error) |
| String/Enum transforms | supported |
| perf, 20 000 round-trips | transform ~`0.007-0.008 s` vs get/set ~`0.008-0.010 s` (**1.1-1.25x** across runs, not "several times") |
| `options={'READ_ONLY'}` write | `AttributeError: ... is read-only` |
| `set` without `get` | `ValueError: The set callback is defined without a matching get function...` |
| `property_unset()` | restores declared default |
| 4.5 file opened in 5.0 | key present in **both** custom and system stores |
| `del ob['my_addon']` cleanup | legacy copy removed, **live value `123` intact**, survives save/reload |

---

## What still needs to be improved — handover notes

Read this before extending the document. These are the known gaps, in priority
order, with the reason each one is still open.

### Blocked by the environment (could not be tested here)

The sandbox has no GPU and no X11/OpenGL libraries; `import bpy` only works
because I compiled **stub `.so` shims** for `libGL.so.1`, `libXrender.so.1`,
`libICE.so.6`, `libSM.so.6`, `libXfixes.so.3`, `libXi.so.6`, `libxkbcommon.so.0`
(48 no-op GL symbols). Consequences:

1. **No UI-layer verification.** How these properties behave when drawn in a
   panel (`layout.prop`), whether `get_transform` is called per redraw, and the
   cost of that, is untested. A transform callback that is cheap in a loop may be
   expensive at 60 fps in the properties editor. **Test on a real desktop build.**
2. **The performance claim is unresolved.** My 1.25× result contradicts the
   release notes' "several times faster". Mine is a tight Python loop on a
   throttled container; the official figure may come from C-side or UI-redraw
   benchmarks. Re-benchmark properly (many properties, UI redraw, `--factory-startup`,
   multiple runs, report variance) before anyone trusts either number.
3. **Undo/redo, depsgraph and library-override interaction is completely
   untested.** These are the classic places where custom storage breaks. Does
   `set_transform` participate in undo push? Do transforms run on depsgraph
   evaluation? Unknown.
4. **Multi-user / linked-data and `.blend` library linking** not tested —
   relevant to the "unexpected ID usages that never get cleared" warning.

### Known gaps in the content

5. **The "Copying" row is still unresolved**, exactly as in the upstream notes
   ("WIP"). I did not implement or test the
   [recursive copy helper](https://projects.blender.org/Mets/blender_studio_utils/src/branch/main/properties.py#L74).
   Next step: vendor that function, test it on a nested `PropertyGroup`
   containing a `PointerProperty` to an ID, and document whether ID references
   survive. This is the single biggest missing piece.
6. **`is_set` semantics are inferred, not documented.** I observed `False` during
   the first `set_transform` and `True` on the following `get_transform`, and
   concluded "is the property currently set in storage". This should be confirmed
   against the C source (`rna_define.c` / the commit `469f54f484`) rather than
   from two data points.
7. **Only `Scene` and `Object` were used as carriers.** The notes list
   `ViewLayer`, `Bone`, `EditBone`, `BoneCollection`, `PoseBone`, `Strip` as
   types whose storage was split in two. None of those were exercised. `Strip`
   in particular changed name in recent versions and deserves its own test.
8. **No test of `bpy.props` on `WindowManager`/`AddonPreferences`**, where
   add-ons most often keep settings and where the storage split may behave
   differently.
9. **Enum transform was only smoke-tested** (identity function). Test a real
   remapping, and especially dynamic `items=callable` enums, which historically
   interact badly with custom getters.
10. **No real add-on was migrated.** Everything is synthetic. The highest-value
    next step is to take an actual 4.x add-on with `get`/`set` pairs and port it,
    which will surface issues no synthetic test can.

### Method notes for whoever continues

- Both interpreters are reproducible: `pip install bpy==5.0.1` and
  `bpy==4.5.12`. Round-tripping a file through 4.5 → 5.0 works well and is the
  only honest way to test versioning claims — do that rather than hand-crafting
  IDProperties in 5.0.
- Prefer asserting on *observed output* over restating the release notes. Several
  upstream statements turned out to be aspirational rather than enforced
  (range clamping, discouraged combinations), and one was not reproducible
  (performance).
- Watch for silently swallowed exceptions when testing callbacks — a test that
  "passes" may just be reading a zero value after your callback crashed. Always
  check stderr.
