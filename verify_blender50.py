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
