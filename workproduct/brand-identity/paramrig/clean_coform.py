"""Compose the logo from its two editable vector masters; never trace lettering."""
from copy import deepcopy
from pathlib import Path
import xml.etree.ElementTree as ET

WORK = Path(__file__).resolve().parent
ASSETS = WORK.parents[2] / "assets/brand"
NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", NS)


def compose():
    root = ET.Element(f"{{{NS}}}svg", {
        "width": "383", "height": "404", "viewBox": "0 0 383 404",
        "fill": "currentColor", "role": "img", "aria-label": "ParamRig",
    })
    ET.SubElement(root, f"{{{NS}}}title").text = "ParamRig — Coform logo"
    for filename, offset in (
        ("paramrig-coform-symbol.svg", "36 0"),
        ("paramrig-wordmark.svg", "0 318"),
    ):
        group = ET.SubElement(root, f"{{{NS}}}g", {"transform": f"translate({offset})"})
        source = ET.parse(ASSETS / filename).getroot()
        for element in source:
            if element.tag != f"{{{NS}}}title":
                group.append(deepcopy(element))
    ET.indent(root, space="  ")
    (ASSETS / "paramrig-coform-logo.svg").write_text(
        ET.tostring(root, encoding="unicode") + "\n"
    )


if __name__ == "__main__":
    compose()
    print("Composed Coform symbol + custom vector wordmark (no raster input).")
