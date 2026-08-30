"""Check clean paths and show the visible delta against the archived trace."""
from pathlib import Path
import json
import re
import xml.etree.ElementTree as ET

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.spatial import cKDTree

from verify_coform import boundary, iou

WORK=Path(__file__).resolve().parent
ROOT=WORK.parents[2]
QA=WORK/"cleanup-qa"


def angle(a,b):
    return float(np.degrees(np.arccos(np.clip(np.dot(a,b)/(np.linalg.norm(a)*np.linalg.norm(b)),-1,1))))


def joins(d):
    tokens=re.findall(r"[MCHVZ]|-?\d+(?:\.\d+)?",d)
    segments=[]
    i=0
    while i<len(tokens):
        cmd=tokens[i]; i+=1
        if cmd=="M":
            point=np.array([float(tokens[i]),float(tokens[i+1])]); i+=2
        elif cmd=="C":
            c=np.array([float(v) for v in tokens[i:i+6]]).reshape(3,2); i+=6
            segments.append((point,c[-1],c[0]-point,c[-1]-c[-2]))
            point=c[-1]
        elif cmd in "HV":
            target=point.copy(); target[0 if cmd=="H" else 1]=float(tokens[i]); i+=1
            segments.append((point,target,target-point,target-point)); point=target
        elif cmd!="Z":
            raise AssertionError(cmd)
    return [angle(a[3],b[2]) for a,b in zip(segments,segments[1:]+segments[:1])]


def run():
    # Calibration: a true right angle and parallel vectors must report 90 and 0.
    assert abs(angle(np.array([1.,0]),np.array([0.,1]))-90)<1e-8
    assert angle(np.array([1.,0]),np.array([2.,0]))==0
    square=np.zeros((64,64),dtype=bool); square[12:52,12:52]=True
    assert iou(square,square)==1
    assert abs(iou(square,np.roll(square,1,axis=1))-39/41)<1e-12
    result={"calibration":"0/90 degree joins and exact known mask shifts passed","assets":{}}
    for name in ["symbol","logo"]:
        old=Image.open(QA/f"{name}-before-4x.png").convert("L")
        new=Image.open(QA/f"{name}-after-4x.png").convert("L")
        a,b=boundary(old,4),boundary(new,4)
        dist=np.r_[cKDTree(a).query(b)[0],cKDTree(b).query(a)[0]]
        path=Path(__file__).resolve().parent/f"reference/svg-v2/paramrig-coform-{name}.svg"
        text=path.read_text()
        original=(WORK/f"reference/svg-v1/paramrig-coform-{name}.svg").read_text()
        assert "<image" not in text and "<text" not in text
        data={"curve_commands_before":len(re.findall(r"[CQ]",original)),
              "curve_commands_after":len(re.findall(r"[CQ]",text)),
              "bytes_before":len(original.encode()),"bytes_after":len(text.encode()),
              "p95_distance_from_v1_px":float(np.percentile(dist,95)),
              "max_distance_from_v1_px":float(max(dist)),
              "foreground_iou_vs_v1":iou(np.array(old)<128,np.array(new)<128)}
        assert data["foreground_iou_vs_v1"]>.97
        assert data["max_distance_from_v1_px"]<3
        result["assets"][name]=data
    mark=ET.parse(Path(__file__).resolve().parent/"reference/svg-v2/paramrig-coform-symbol.svg").getroot()
    contours=[node.attrib["d"] for node in mark if node.tag.endswith("path")]
    values=[a for d in contours for a in joins(d)]
    # The right piece has one intentional cusp: the upper tip of the P aperture.
    smooth=[v for v in values if v<90]
    assert len([v for v in values if v>=90])==1
    assert max(smooth)<.1
    result["symbol_joins"]={"intentional_cusps":1,"max_other_join_angle_degrees":max(smooth)}
    (QA/"results.json").write_text(json.dumps(result,indent=2)+"\n")
    font=ImageFont.load_default(size=22)
    small=ImageFont.load_default(size=16)
    plate=Image.new("RGB",(1280,1080),"white"); draw=ImageDraw.Draw(plate)
    draw.text((32,22),"Coform / optical cleanup",font=font,fill="black")
    for col,(version,label) in enumerate([("before","Original trace"),("after","Clean geometry")]):
        x=32+col*640
        draw.text((x,68),label,font=font,fill="black")
        full=Image.open(QA/f"symbol-{version}-4x.png").convert("RGB")
        full.thumbnail((565,420),Image.Resampling.LANCZOS); plate.paste(full,(x,110))
        draw.text((x,565),"Inner upper corner / 12x",font=small,fill="black")
        corner=Image.open(QA/f"symbol-{version}-8x.png").convert("RGB").crop((119*8,67*8,159*8,89*8))
        corner=corner.resize((480,264),Image.Resampling.LANCZOS); plate.paste(corner,(x,600))
        for k,width in enumerate([16,24,32,64]):
            plate.paste(Image.open(QA/f"symbol-{version}-{width}px.png").convert("RGB"),(x+k*100,915))
            draw.text((x+k*100,990),f"{width}px",font=small,fill="black")
    draw.text((32,1040),"Same concept, spacing and proportions. Original trace retained. No raster embedded.",font=small,fill="black")
    plate.save(QA/"comparison.png")
    print(json.dumps(result,indent=2))


if __name__=="__main__":
    run()
