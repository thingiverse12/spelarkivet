import bpy, json
r={}
def gt(self,value,is_set): return value*2
def st(self,value,old,is_set): return value+1
bpy.types.Scene.tp=bpy.props.IntProperty(get_transform=gt,set_transform=st,default=0)
sc=bpy.context.scene
sc.tp=10; r["set10_then_read"]=sc.tp   # stored 11 -> read 22
r["stored"]=sc.bl_system_properties_get()["tp"]
def vgt(self,value,is_set): return [x*2 for x in value]
def vst(self,value,old,is_set): return [x+1 for x in value]
bpy.types.Scene.vp=bpy.props.FloatVectorProperty(size=3,get_transform=vgt,set_transform=vst)
sc.vp=(1,2,3); r["vec"]=[round(x,2) for x in sc.vp]
bpy.types.Scene.ro=bpy.props.IntProperty(options={'READ_ONLY'},default=5)
r["ro_read"]=sc.ro
try: sc.ro=9; r["ro_write"]="allowed"
except Exception as e: r["ro_write"]=f"{type(e).__name__}: {e}"
try:
    bpy.types.Scene.bad=bpy.props.IntProperty(set=lambda s,v:None)
except Exception as e: r["set_without_get"]=str(e)
bpy.types.Scene.mp=bpy.props.IntProperty(default=3); sc.mp=7
try: r["dict"]=sc["mp"]
except Exception as e: r["dict"]=f"{type(e).__name__}"
r["sysprops_mp"]=sc.bl_system_properties_get()["mp"]
sc["cp"]=42; r["custom_dict"]=sc["cp"]
r["ID_api"]=[m for m in dir(bpy.types.ID) if "system_propert" in m]
print(json.dumps(r,indent=2))
