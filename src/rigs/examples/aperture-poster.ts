import type { VectorDocument } from '@/vector/types'

/**
 * A poster that carries its own controls.
 *
 * The mark next door is a mark: three shapes and five controls, small enough to read in one look.
 * This is what the editor is for the rest of the time — twenty-one layers, gradients, an arc, a
 * blur, a drop shadow and type — with eight controls wired into the properties that decide how it
 * reads. Open it and it is a drawing; turn to Tune and it is a rig, without becoming a second file.
 */
export const APERTURE_POSTER_ID = 'vector-example-aperture-poster'

export const aperturePosterDocument: VectorDocument = {
    "version": 1,
    "id": "vector-example-aperture-poster",
    "name": "Aperture poster",
    "background": "#101211",
    "width": 900,
    "height": 1200,
    "elements": [
      {
        "id": "backdrop",
        "kind": "rectangle",
        "name": "Backdrop",
        "x": 0,
        "y": 0,
        "width": 900,
        "height": 1200,
        "rotation": 0,
        "fill": "#EFEBE2",
        "stroke": "none",
        "strokeWidth": 0,
        "opacity": 1,
        "visible": true,
        "locked": false,
        "fills": [
          {
            "id": "paint-1",
            "type": "solid",
            "opacity": 1,
            "visible": true,
            "color": "#EFEBE2"
          },
          {
            "id": "paint-2",
            "type": "linear",
            "opacity": 0.55,
            "visible": true,
            "angle": 155,
            "stops": [
              {
                "t": 0,
                "color": "#FFFFFF"
              },
              {
                "t": 0.55,
                "color": "#EFEBE2"
              },
              {
                "t": 1,
                "color": "#DCD6C9"
              }
            ]
          }
        ]
      },
      {
        "id": "halo",
        "kind": "ellipse",
        "name": "Halo",
        "x": 110,
        "y": 170,
        "width": 680,
        "height": 680,
        "rotation": 0,
        "fill": "#8FBFAE",
        "stroke": "none",
        "strokeWidth": 0,
        "opacity": 0.5,
        "visible": true,
        "locked": false,
        "fills": [
          {
            "id": "paint-3",
            "type": "radial",
            "opacity": 1,
            "visible": true,
            "center": {
              "x": 0.5,
              "y": 0.45
            },
            "radius": 0.55,
            "stops": [
              {
                "t": 0,
                "color": "#8FBFAE"
              },
              {
                "t": 1,
                "color": "#EFEBE2"
              }
            ]
          }
        ],
        "effects": [
          {
            "id": "effect-4",
            "kind": "layerBlur",
            "visible": true,
            "blur": 48
          }
        ]
      },
      {
        "id": "ring-outer",
        "kind": "ellipse",
        "name": "Ring · outer",
        "x": 185,
        "y": 245,
        "width": 530,
        "height": 530,
        "rotation": 0,
        "fill": "none",
        "stroke": "#8FBFAE",
        "strokeWidth": 2,
        "opacity": 1,
        "visible": true,
        "locked": false
      },
      {
        "id": "ring-middle",
        "kind": "ellipse",
        "name": "Ring · middle",
        "x": 240,
        "y": 300,
        "width": 420,
        "height": 420,
        "rotation": 0,
        "fill": "none",
        "stroke": "#8FBFAE",
        "strokeWidth": 1.5,
        "opacity": 0.8,
        "visible": true,
        "locked": false
      },
      {
        "id": "ring-inner",
        "kind": "ellipse",
        "name": "Ring · inner",
        "x": 295,
        "y": 355,
        "width": 310,
        "height": 310,
        "rotation": 0,
        "fill": "none",
        "stroke": "#8FBFAE",
        "strokeWidth": 1,
        "opacity": 0.6,
        "visible": true,
        "locked": false
      },
      {
        "id": "aperture",
        "kind": "ellipse",
        "name": "Aperture",
        "x": 325,
        "y": 385,
        "width": 250,
        "height": 250,
        "rotation": 0,
        "fill": "#1F3A34",
        "stroke": "none",
        "strokeWidth": 0,
        "opacity": 1,
        "visible": true,
        "locked": false,
        "arcStart": 20,
        "arcSweep": 320,
        "arcRatio": 0.42,
        "effects": [
          {
            "id": "effect-5",
            "kind": "dropShadow",
            "visible": true,
            "dx": 0,
            "dy": 18,
            "blur": 44,
            "spread": 0,
            "color": "#1F3A34",
            "opacity": 0.28
          }
        ]
      },
      {
        "id": "blade",
        "kind": "polygon",
        "name": "Blade",
        "x": 385,
        "y": 445,
        "width": 130,
        "height": 130,
        "rotation": 14,
        "fill": "#C4633F",
        "stroke": "none",
        "strokeWidth": 0,
        "opacity": 1,
        "visible": true,
        "locked": false,
        "sides": 6,
        "blendMode": "multiply"
      },
      {
        "id": "core",
        "kind": "rectangle",
        "name": "Core",
        "x": 420,
        "y": 480,
        "width": 60,
        "height": 60,
        "rotation": 0,
        "fill": "#EFEBE2",
        "stroke": "none",
        "strokeWidth": 0,
        "opacity": 1,
        "visible": true,
        "locked": false,
        "cornerRadius": 16,
        "cornerSmoothing": 0.6
      },
      {
        "id": "rule-01",
        "kind": "rectangle",
        "name": "Rule 01",
        "x": 90,
        "y": 880,
        "width": 720,
        "height": 1,
        "rotation": 0,
        "fill": "#16181A",
        "stroke": "none",
        "strokeWidth": 0,
        "opacity": 0.35,
        "visible": true,
        "locked": false
      },
      {
        "id": "rule-02",
        "kind": "rectangle",
        "name": "Rule 02",
        "x": 90,
        "y": 894,
        "width": 540,
        "height": 1,
        "rotation": 0,
        "fill": "#16181A",
        "stroke": "none",
        "strokeWidth": 0,
        "opacity": 0.31,
        "visible": true,
        "locked": false
      },
      {
        "id": "rule-03",
        "kind": "rectangle",
        "name": "Rule 03",
        "x": 90,
        "y": 908,
        "width": 610,
        "height": 1,
        "rotation": 0,
        "fill": "#16181A",
        "stroke": "none",
        "strokeWidth": 0,
        "opacity": 0.26999999999999996,
        "visible": true,
        "locked": false
      },
      {
        "id": "rule-04",
        "kind": "rectangle",
        "name": "Rule 04",
        "x": 90,
        "y": 922,
        "width": 380,
        "height": 1,
        "rotation": 0,
        "fill": "#16181A",
        "stroke": "none",
        "strokeWidth": 0,
        "opacity": 0.22999999999999998,
        "visible": true,
        "locked": false
      },
      {
        "id": "rule-05",
        "kind": "rectangle",
        "name": "Rule 05",
        "x": 90,
        "y": 936,
        "width": 470,
        "height": 1,
        "rotation": 0,
        "fill": "#16181A",
        "stroke": "none",
        "strokeWidth": 0,
        "opacity": 0.18999999999999997,
        "visible": true,
        "locked": false
      },
      {
        "id": "rule-06",
        "kind": "rectangle",
        "name": "Rule 06",
        "x": 90,
        "y": 950,
        "width": 300,
        "height": 1,
        "rotation": 0,
        "fill": "#16181A",
        "stroke": "none",
        "strokeWidth": 0,
        "opacity": 0.14999999999999997,
        "visible": true,
        "locked": false
      },
      {
        "id": "divider",
        "kind": "rectangle",
        "name": "Divider",
        "x": 90,
        "y": 990,
        "width": 720,
        "height": 2,
        "rotation": 0,
        "fill": "#16181A",
        "stroke": "none",
        "strokeWidth": 0,
        "opacity": 1,
        "visible": true,
        "locked": false
      },
      {
        "id": "title",
        "kind": "text",
        "name": "Title",
        "x": 90,
        "y": 1006,
        "width": 720,
        "height": 110,
        "rotation": 0,
        "fill": "#16181A",
        "stroke": "none",
        "strokeWidth": 0,
        "opacity": 1,
        "visible": true,
        "locked": false,
        "text": "APERTURE",
        "fontFamily": "Public Sans",
        "fontSize": 92,
        "fontWeight": 600,
        "lineHeight": 1.05,
        "letterSpacing": -3.5,
        "textAlign": "left",
        "textSizing": "fixed"
      },
      {
        "id": "subtitle",
        "kind": "text",
        "name": "Subtitle",
        "x": 90,
        "y": 1116,
        "width": 430,
        "height": 34,
        "rotation": 0,
        "fill": "#4A4F4C",
        "stroke": "none",
        "strokeWidth": 0,
        "opacity": 1,
        "visible": true,
        "locked": false,
        "text": "Field study 04 · shape, light, aperture",
        "fontFamily": "Public Sans",
        "fontSize": 22,
        "fontWeight": 400,
        "lineHeight": 1.3,
        "letterSpacing": 0,
        "textAlign": "left",
        "textSizing": "fixed"
      },
      {
        "id": "index",
        "kind": "text",
        "name": "Index",
        "x": 690,
        "y": 90,
        "width": 120,
        "height": 28,
        "rotation": 0,
        "fill": "#4A4F4C",
        "stroke": "none",
        "strokeWidth": 0,
        "opacity": 1,
        "visible": true,
        "locked": false,
        "text": "04 / 12",
        "fontFamily": "Public Sans",
        "fontSize": 20,
        "fontWeight": 500,
        "lineHeight": 1.3,
        "letterSpacing": 0,
        "textAlign": "right",
        "textSizing": "fixed"
      },
      {
        "id": "imprint",
        "kind": "text",
        "name": "Imprint",
        "x": 90,
        "y": 90,
        "width": 320,
        "height": 60,
        "rotation": 0,
        "fill": "#4A4F4C",
        "stroke": "none",
        "strokeWidth": 0,
        "opacity": 1,
        "visible": true,
        "locked": false,
        "text": "Paper, ink and one\nopening of light",
        "fontFamily": "Public Sans",
        "fontSize": 20,
        "fontWeight": 400,
        "lineHeight": 1.45,
        "letterSpacing": 0,
        "textAlign": "left",
        "textSizing": "fixed"
      },
      {
        "id": "mark-top-left",
        "kind": "rectangle",
        "name": "Mark · top left",
        "x": 90,
        "y": 168,
        "width": 26,
        "height": 1,
        "rotation": 0,
        "fill": "#16181A",
        "stroke": "none",
        "strokeWidth": 0,
        "opacity": 1,
        "visible": true,
        "locked": false
      },
      {
        "id": "mark-top-right",
        "kind": "rectangle",
        "name": "Mark · top right",
        "x": 784,
        "y": 168,
        "width": 26,
        "height": 1,
        "rotation": 0,
        "fill": "#16181A",
        "stroke": "none",
        "strokeWidth": 0,
        "opacity": 1,
        "visible": true,
        "locked": false
      }
    ],
    "guides": [
      {
        "id": "guide-6",
        "axis": "x",
        "position": 90
      },
      {
        "id": "guide-7",
        "axis": "x",
        "position": 810
      },
      {
        "id": "guide-8",
        "axis": "y",
        "position": 168
      },
      {
        "id": "guide-9",
        "axis": "y",
        "position": 990
      }
    ],
    "swatches": [
      "#EFEBE2",
      "#16181A",
      "#8FBFAE",
      "#C4633F",
      "#1F3A34"
    ],
    "rig": {
      "groups": [
        {
          "id": "shape",
          "label": "Shape"
        },
        {
          "id": "ink",
          "label": "Ink"
        },
        {
          "id": "type",
          "label": "Type"
        }
      ],
      "parameters": [
        {
          "kind": "number",
          "id": "opening",
          "label": "Opening",
          "group": "shape",
          "min": 40,
          "max": 360,
          "step": 1,
          "defaultValue": 320,
          "unit": "°"
        },
        {
          "kind": "number",
          "id": "blades",
          "label": "Blades",
          "group": "shape",
          "min": 3,
          "max": 12,
          "step": 1,
          "defaultValue": 6
        },
        {
          "kind": "number",
          "id": "turn",
          "label": "Blade turn",
          "group": "shape",
          "min": 0,
          "max": 360,
          "step": 1,
          "defaultValue": 14,
          "unit": "°"
        },
        {
          "kind": "number",
          "id": "coreRadius",
          "label": "Core radius",
          "group": "shape",
          "min": 0,
          "max": 30,
          "step": 1,
          "defaultValue": 16,
          "unit": "px"
        },
        {
          "kind": "number",
          "id": "ringWeight",
          "label": "Ring weight",
          "group": "ink",
          "min": 0.5,
          "max": 8,
          "step": 0.5,
          "defaultValue": 2,
          "unit": "px"
        },
        {
          "kind": "color",
          "id": "accent",
          "label": "Accent",
          "group": "ink",
          "defaultValue": "#C4633F"
        },
        {
          "kind": "number",
          "id": "titleSize",
          "label": "Title size",
          "group": "type",
          "min": 40,
          "max": 140,
          "step": 1,
          "defaultValue": 92,
          "unit": "px"
        },
        {
          "kind": "number",
          "id": "tracking",
          "label": "Tracking",
          "group": "type",
          "min": -8,
          "max": 4,
          "step": 0.5,
          "defaultValue": -3.5,
          "unit": "px"
        }
      ],
      "bindings": [
        {
          "id": "binding-10",
          "elementId": "aperture",
          "property": "arcSweep",
          "parameterId": "opening"
        },
        {
          "id": "binding-11",
          "elementId": "blade",
          "property": "sides",
          "parameterId": "blades"
        },
        {
          "id": "binding-12",
          "elementId": "blade",
          "property": "rotation",
          "parameterId": "turn"
        },
        {
          "id": "binding-13",
          "elementId": "core",
          "property": "cornerRadius",
          "parameterId": "coreRadius"
        },
        {
          "id": "binding-14",
          "elementId": "ring-outer",
          "property": "strokeWidth",
          "parameterId": "ringWeight"
        },
        {
          "id": "binding-15",
          "elementId": "blade",
          "property": "fill",
          "parameterId": "accent"
        },
        {
          "id": "binding-16",
          "elementId": "title",
          "property": "fontSize",
          "parameterId": "titleSize"
        },
        {
          "id": "binding-17",
          "elementId": "title",
          "property": "letterSpacing",
          "parameterId": "tracking"
        }
      ]
    },
    "createdAt": "2026-09-07T00:00:00.000Z",
    "updatedAt": "2026-09-07T00:00:00.000Z"
  }
