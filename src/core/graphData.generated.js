/**
 * 此文件由 scripts/gen-graph.mjs 自动生成, 请勿手改。
 * 重新生成: npm run graph
 *
 * 内容: 参数组与叶子字段 / 模块与函数 / 函数调用边 / 参数引用边。
 * 供 components/FunctionGraph.vue 只读渲染"参数与调用关系图谱"。
 */
export const GRAPH_DATA = {
  "params": [
    {
      "id": "seed",
      "name": "seed",
      "fields": [
        {
          "path": "seed",
          "value": "20240607"
        }
      ]
    },
    {
      "id": "auto",
      "name": "auto",
      "fields": [
        {
          "path": "chaos",
          "value": "0.6"
        }
      ]
    },
    {
      "id": "classify",
      "name": "classify",
      "fields": [
        {
          "path": "species",
          "value": "oak"
        },
        {
          "path": "stage",
          "value": "mature"
        },
        {
          "path": "season",
          "value": "summer"
        }
      ]
    },
    {
      "id": "trunk",
      "name": "trunk",
      "fields": [
        {
          "path": "height",
          "value": "9"
        },
        {
          "path": "baseRadius",
          "value": "0.34"
        },
        {
          "path": "taper",
          "value": "0.06"
        },
        {
          "path": "radiusCurve",
          "value": "1.35"
        },
        {
          "path": "segments",
          "value": "14"
        },
        {
          "path": "radialSegments",
          "value": "10"
        },
        {
          "path": "curve",
          "value": "0.38"
        },
        {
          "path": "curveVariance",
          "value": "0.3"
        },
        {
          "path": "lean",
          "value": "0.06"
        },
        {
          "path": "leanDirection",
          "value": "20"
        },
        {
          "path": "twist",
          "value": "0.18"
        },
        {
          "path": "twistProfile",
          "value": "[0,0,0,0,0]"
        },
        {
          "path": "gnarl",
          "value": "0.35"
        },
        {
          "path": "flare",
          "value": "0.9"
        },
        {
          "path": "flareHeight",
          "value": "0.18"
        },
        {
          "path": "knots",
          "value": "2"
        },
        {
          "path": "knotSize",
          "value": "0.35"
        },
        {
          "path": "knotStrength",
          "value": "0.75"
        },
        {
          "path": "knotSpread",
          "value": "0.05"
        },
        {
          "path": "knotAngle",
          "value": "0.7"
        },
        {
          "path": "knotNoise",
          "value": "0"
        },
        {
          "path": "spineNoise",
          "value": "0"
        },
        {
          "path": "crossNoise",
          "value": "0"
        },
        {
          "path": "squash",
          "value": "1"
        },
        {
          "path": "onePiece",
          "value": "false"
        },
        {
          "path": "fork.enabled",
          "value": "false"
        },
        {
          "path": "fork.count",
          "value": "3"
        },
        {
          "path": "fork.height",
          "value": "0.34"
        },
        {
          "path": "fork.angle",
          "value": "26"
        },
        {
          "path": "fork.spread",
          "value": "0.8"
        },
        {
          "path": "fork.radiusScale",
          "value": "0.62"
        },
        {
          "path": "fork.lengthScale",
          "value": "1"
        },
        {
          "path": "fork.taper",
          "value": "0.3"
        },
        {
          "path": "fork.curve",
          "value": "0.4"
        },
        {
          "path": "fork.gravity",
          "value": "0.03"
        },
        {
          "path": "fork.trunkShrink",
          "value": "0.62"
        }
      ]
    },
    {
      "id": "roots",
      "name": "roots",
      "fields": [
        {
          "path": "enabled",
          "value": "false"
        },
        {
          "path": "count",
          "value": "5"
        },
        {
          "path": "length",
          "value": "0.22"
        },
        {
          "path": "lengthVariance",
          "value": "0.35"
        },
        {
          "path": "radiusRatio",
          "value": "0.35"
        },
        {
          "path": "spread",
          "value": "1"
        },
        {
          "path": "pitch",
          "value": "118"
        },
        {
          "path": "segments",
          "value": "5"
        },
        {
          "path": "radialSegments",
          "value": "5"
        },
        {
          "path": "curve",
          "value": "0.5"
        },
        {
          "path": "sink",
          "value": "0.35"
        },
        {
          "path": "heightOffset",
          "value": "0"
        },
        {
          "path": "autoStagger",
          "value": "true"
        }
      ]
    },
    {
      "id": "branches",
      "name": "branches",
      "fields": [
        {
          "path": "levels",
          "value": "3"
        },
        {
          "path": "level[].enabled",
          "value": "true"
        },
        {
          "path": "level[].count",
          "value": "7"
        },
        {
          "path": "level[].pitch",
          "value": "62"
        },
        {
          "path": "level[].pitchVariance",
          "value": "14"
        },
        {
          "path": "level[].lengthRatio",
          "value": "0.42"
        },
        {
          "path": "level[].lengthVariance",
          "value": "0.22"
        },
        {
          "path": "level[].radiusRatio",
          "value": "0.4"
        },
        {
          "path": "level[].radiusVariance",
          "value": "0.18"
        },
        {
          "path": "level[].startT",
          "value": "0.22"
        },
        {
          "path": "level[].endT",
          "value": "0.96"
        },
        {
          "path": "level[].startJitter",
          "value": "0.05"
        },
        {
          "path": "level[].taper",
          "value": "0.5"
        },
        {
          "path": "level[].radiusCurve",
          "value": "1.25"
        },
        {
          "path": "level[].curve",
          "value": "0.3"
        },
        {
          "path": "level[].curveVariance",
          "value": "0.35"
        },
        {
          "path": "level[].gravity",
          "value": "0.06"
        },
        {
          "path": "level[].twist",
          "value": "0.25"
        },
        {
          "path": "level[].phyllotaxis",
          "value": "137.5"
        },
        {
          "path": "level[].spread",
          "value": "0.14"
        },
        {
          "path": "level[].upBias",
          "value": "0.06"
        },
        {
          "path": "level[].segments",
          "value": "9"
        },
        {
          "path": "level[].radialSegments",
          "value": "7"
        },
        {
          "path": "level[].crossSection",
          "value": "round"
        },
        {
          "path": "level[].starDepth",
          "value": "0.2"
        },
        {
          "path": "level[].windGain",
          "value": "0.55"
        },
        {
          "path": "level[].nodeRoll",
          "value": "0"
        },
        {
          "path": "level[].nodeOffset",
          "value": "0"
        },
        {
          "path": "level[].nodeJumble",
          "value": "0"
        },
        {
          "path": "level[].nodeRollBias",
          "value": "0"
        },
        {
          "path": "level[].nodeJumbleBias",
          "value": "0"
        },
        {
          "path": "level[].spineNoise",
          "value": "0"
        },
        {
          "path": "level[].crossNoise",
          "value": "0"
        },
        {
          "path": "gravityScale",
          "value": "1"
        },
        {
          "path": "phototropism",
          "value": "0.05"
        },
        {
          "path": "lengthScale",
          "value": "1"
        },
        {
          "path": "radiusScale",
          "value": "1"
        },
        {
          "path": "startSpread",
          "value": "0"
        },
        {
          "path": "apicalDominance",
          "value": "0.35"
        },
        {
          "path": "twistProfile",
          "value": "[0,0,0,0,0]"
        }
      ]
    },
    {
      "id": "leaves",
      "name": "leaves",
      "fields": [
        {
          "path": "enabled",
          "value": "true"
        },
        {
          "path": "levels",
          "value": "[false,false,true,true,true]"
        },
        {
          "path": "perBranch",
          "value": "9"
        },
        {
          "path": "clusterCount",
          "value": "3"
        },
        {
          "path": "clusterRadius",
          "value": "0"
        },
        {
          "path": "clusterSpread",
          "value": "0"
        },
        {
          "path": "size",
          "value": "0.42"
        },
        {
          "path": "sizeVariance",
          "value": "0.28"
        },
        {
          "path": "width",
          "value": "0.78"
        },
        {
          "path": "shape",
          "value": "oval"
        },
        {
          "path": "segments",
          "value": "5"
        },
        {
          "path": "curl",
          "value": "0.18"
        },
        {
          "path": "fold",
          "value": "0.28"
        },
        {
          "path": "startT",
          "value": "0"
        },
        {
          "path": "endT",
          "value": "1"
        },
        {
          "path": "branchWrap",
          "value": "false"
        },
        {
          "path": "branchWrapTurns",
          "value": "2"
        },
        {
          "path": "pitch",
          "value": "-30"
        },
        {
          "path": "pitchVariance",
          "value": "28"
        },
        {
          "path": "droop",
          "value": "0.35"
        },
        {
          "path": "rollVariance",
          "value": "180"
        },
        {
          "path": "faceUp",
          "value": "0.5"
        },
        {
          "path": "twist",
          "value": "0.25"
        },
        {
          "path": "modelRotation",
          "value": "0"
        },
        {
          "path": "color",
          "value": "#5da03a"
        },
        {
          "path": "colorTip",
          "value": "#a6d45e"
        },
        {
          "path": "colorVariance",
          "value": "0.22"
        },
        {
          "path": "petiole",
          "value": "0.12"
        },
        {
          "path": "cardMode",
          "value": "true"
        },
        {
          "path": "cardAspect",
          "value": "1"
        },
        {
          "path": "cardCurl",
          "value": "0.1"
        },
        {
          "path": "cardFold",
          "value": "0.12"
        }
      ]
    },
    {
      "id": "fall",
      "name": "fall",
      "fields": [
        {
          "path": "enabled",
          "value": "false"
        },
        {
          "path": "inheritLeafMat",
          "value": "true"
        },
        {
          "path": "cardId",
          "value": ""
        },
        {
          "path": "count",
          "value": "80"
        },
        {
          "path": "speed",
          "value": "1"
        },
        {
          "path": "size",
          "value": "0.55"
        },
        {
          "path": "swirl",
          "value": "1"
        },
        {
          "path": "spinSpeed",
          "value": "1.2"
        },
        {
          "path": "stagger",
          "value": "0.6"
        },
        {
          "path": "spread",
          "value": "1"
        },
        {
          "path": "windFollow",
          "value": "1"
        },
        {
          "path": "color",
          "value": "#d9a441"
        },
        {
          "path": "opacity",
          "value": "1"
        },
        {
          "path": "alphaTest",
          "value": "0.35"
        }
      ]
    },
    {
      "id": "litter",
      "name": "litter",
      "fields": [
        {
          "path": "enabled",
          "value": "false"
        },
        {
          "path": "inheritLeafMat",
          "value": "true"
        },
        {
          "path": "cardId",
          "value": ""
        },
        {
          "path": "count",
          "value": "260"
        },
        {
          "path": "radius",
          "value": "1"
        },
        {
          "path": "size",
          "value": "0.55"
        },
        {
          "path": "thickness",
          "value": "0.06"
        },
        {
          "path": "color",
          "value": "#ffffff"
        },
        {
          "path": "colorVariance",
          "value": "0.45"
        },
        {
          "path": "alphaTest",
          "value": "0.35"
        },
        {
          "path": "shade",
          "value": "0.78"
        }
      ]
    },
    {
      "id": "particles",
      "name": "particles",
      "fields": [
        {
          "path": "enabled",
          "value": "false"
        },
        {
          "path": "count",
          "value": "240"
        },
        {
          "path": "size",
          "value": "0.05"
        },
        {
          "path": "speed",
          "value": "0.35"
        },
        {
          "path": "fall",
          "value": "1"
        },
        {
          "path": "sway",
          "value": "1"
        },
        {
          "path": "swirl",
          "value": "0.6"
        },
        {
          "path": "color",
          "value": "#fff0b8"
        },
        {
          "path": "opacity",
          "value": "0.85"
        },
        {
          "path": "glow",
          "value": "0.8"
        },
        {
          "path": "spread",
          "value": "1"
        },
        {
          "path": "windFollow",
          "value": "1"
        }
      ]
    },
    {
      "id": "fruit",
      "name": "fruit",
      "fields": [
        {
          "path": "enabled",
          "value": "false"
        },
        {
          "path": "type",
          "value": "acorn"
        },
        {
          "path": "levels",
          "value": "[false,false,false,true,false]"
        },
        {
          "path": "perBranch",
          "value": "2"
        },
        {
          "path": "clusterCount",
          "value": "2"
        },
        {
          "path": "maxCount",
          "value": "420"
        },
        {
          "path": "chance",
          "value": "0.5"
        },
        {
          "path": "clusterRadius",
          "value": "0.07"
        },
        {
          "path": "size",
          "value": "0.16"
        },
        {
          "path": "sizeVariance",
          "value": "0.2"
        },
        {
          "path": "droop",
          "value": "0.5"
        },
        {
          "path": "color",
          "value": "#c8a86a"
        },
        {
          "path": "capColor",
          "value": "#8a6f45"
        },
        {
          "path": "colorVariance",
          "value": "0.18"
        },
        {
          "path": "radial",
          "value": "8"
        }
      ]
    },
    {
      "id": "branchEdits",
      "name": "branchEdits",
      "fields": []
    },
    {
      "id": "forces",
      "name": "forces",
      "fields": [
        {
          "path": "enabled",
          "value": "false"
        },
        {
          "path": "showHelpers",
          "value": "true"
        },
        {
          "path": "items",
          "value": "[]"
        }
      ]
    },
    {
      "id": "bark",
      "name": "bark",
      "fields": [
        {
          "path": "pipeline",
          "value": "speedtree"
        },
        {
          "path": "color",
          "value": "#9a7a54"
        },
        {
          "path": "color2",
          "value": "#b99b73"
        },
        {
          "path": "tint",
          "value": "#ffffff"
        },
        {
          "path": "vertexColorMix",
          "value": "0.9"
        },
        {
          "path": "roughness",
          "value": "0.88"
        },
        {
          "path": "metalness",
          "value": "0"
        },
        {
          "path": "normalScale",
          "value": "1"
        },
        {
          "path": "normalFromAlbedo",
          "value": "1.4"
        },
        {
          "path": "uvWarp",
          "value": "0"
        },
        {
          "path": "uvWarpScale",
          "value": "8"
        },
        {
          "path": "uvScaleU",
          "value": "1"
        },
        {
          "path": "uvScaleV",
          "value": "1"
        },
        {
          "path": "bump",
          "value": "1"
        },
        {
          "path": "texture",
          "value": ""
        },
        {
          "path": "normalTexture",
          "value": ""
        },
        {
          "path": "procedural.enabled",
          "value": "true"
        },
        {
          "path": "procedural.style",
          "value": "rough"
        },
        {
          "path": "procedural.scale",
          "value": "1"
        },
        {
          "path": "procedural.contrast",
          "value": "0.5"
        }
      ]
    },
    {
      "id": "flower",
      "name": "flower",
      "fields": [
        {
          "path": "enabled",
          "value": "false"
        },
        {
          "path": "levels",
          "value": "[false,true,true,true,true]"
        },
        {
          "path": "perBranch",
          "value": "4"
        },
        {
          "path": "branchWrap",
          "value": "false"
        },
        {
          "path": "branchWrapTurns",
          "value": "2"
        },
        {
          "path": "density",
          "value": "1"
        },
        {
          "path": "clusterCount",
          "value": "2"
        },
        {
          "path": "startT",
          "value": "0"
        },
        {
          "path": "endT",
          "value": "1"
        },
        {
          "path": "size",
          "value": "0.42"
        },
        {
          "path": "sizeVariance",
          "value": "0.2"
        },
        {
          "path": "clusterRadius",
          "value": "0"
        },
        {
          "path": "clusterSpread",
          "value": "0"
        },
        {
          "path": "pitch",
          "value": "55"
        },
        {
          "path": "pitchVariance",
          "value": "20"
        },
        {
          "path": "droop",
          "value": "0"
        },
        {
          "path": "rollVariance",
          "value": "0.6"
        },
        {
          "path": "faceUp",
          "value": "true"
        },
        {
          "path": "twist",
          "value": "0"
        },
        {
          "path": "modelRotation",
          "value": "0"
        },
        {
          "path": "segments",
          "value": "3"
        },
        {
          "path": "curl",
          "value": "0.1"
        },
        {
          "path": "fold",
          "value": "0.05"
        },
        {
          "path": "petiole",
          "value": "0"
        },
        {
          "path": "cardCurl",
          "value": "0.1"
        },
        {
          "path": "cardFold",
          "value": "0.12"
        },
        {
          "path": "width",
          "value": "1"
        },
        {
          "path": "color",
          "value": "#f2a7c3"
        },
        {
          "path": "colorTip",
          "value": "#fbe3ec"
        },
        {
          "path": "colorVariance",
          "value": "0.16"
        },
        {
          "path": "translucency",
          "value": "0.7"
        },
        {
          "path": "emissive",
          "value": "0"
        },
        {
          "path": "emissiveColor",
          "value": "#ffffff"
        },
        {
          "path": "specular",
          "value": "0.2"
        },
        {
          "path": "specularShininess",
          "value": "24"
        },
        {
          "path": "specularColor",
          "value": "#ffffff"
        },
        {
          "path": "scatter",
          "value": "0"
        },
        {
          "path": "scatterPower",
          "value": "2"
        },
        {
          "path": "texture",
          "value": ""
        },
        {
          "path": "textureU",
          "value": "0"
        },
        {
          "path": "textureV",
          "value": "0"
        },
        {
          "path": "textureRepeat",
          "value": "1"
        },
        {
          "path": "textureRepeatU",
          "value": "1"
        },
        {
          "path": "textureRepeatV",
          "value": "1"
        },
        {
          "path": "textureRotation",
          "value": "0"
        },
        {
          "path": "tintMode",
          "value": "texture"
        },
        {
          "path": "alphaTest",
          "value": "0.35"
        },
        {
          "path": "normalFromAlbedo",
          "value": "1.5"
        },
        {
          "path": "cardId",
          "value": ""
        },
        {
          "path": "cardAspect",
          "value": "1"
        },
        {
          "path": "cross",
          "value": "none"
        },
        {
          "path": "useShape",
          "value": "false"
        },
        {
          "path": "shape",
          "value": "oval"
        },
        {
          "path": "cardMode",
          "value": "true"
        }
      ]
    },
    {
      "id": "flowerFall",
      "name": "flowerFall",
      "fields": [
        {
          "path": "enabled",
          "value": "false"
        },
        {
          "path": "inheritFlowerMat",
          "value": "true"
        },
        {
          "path": "cardId",
          "value": ""
        },
        {
          "path": "count",
          "value": "140"
        },
        {
          "path": "speed",
          "value": "0.9"
        },
        {
          "path": "size",
          "value": "0.5"
        },
        {
          "path": "swirl",
          "value": "0.8"
        },
        {
          "path": "spinSpeed",
          "value": "1.6"
        },
        {
          "path": "stagger",
          "value": "0.55"
        },
        {
          "path": "spread",
          "value": "1.1"
        },
        {
          "path": "windFollow",
          "value": "0.85"
        },
        {
          "path": "color",
          "value": "#f6c6d8"
        },
        {
          "path": "opacity",
          "value": "0.95"
        },
        {
          "path": "alphaTest",
          "value": "0.3"
        }
      ]
    },
    {
      "id": "flowerLitter",
      "name": "flowerLitter",
      "fields": [
        {
          "path": "enabled",
          "value": "false"
        },
        {
          "path": "inheritFlowerMat",
          "value": "true"
        },
        {
          "path": "cardId",
          "value": ""
        },
        {
          "path": "count",
          "value": "320"
        },
        {
          "path": "radius",
          "value": "1.25"
        },
        {
          "path": "size",
          "value": "0.42"
        },
        {
          "path": "thickness",
          "value": "0.02"
        },
        {
          "path": "color",
          "value": "#f2b8cf"
        },
        {
          "path": "colorVariance",
          "value": "0.35"
        },
        {
          "path": "alphaTest",
          "value": "0.3"
        },
        {
          "path": "shade",
          "value": "0.82"
        }
      ]
    },
    {
      "id": "leafMat",
      "name": "leafMat",
      "fields": [
        {
          "path": "tint",
          "value": "#ffffff"
        },
        {
          "path": "tintMode",
          "value": "season"
        },
        {
          "path": "vertexColorMix",
          "value": "1"
        },
        {
          "path": "roughness",
          "value": "0.62"
        },
        {
          "path": "metalness",
          "value": "0"
        },
        {
          "path": "alphaTest",
          "value": "0.4"
        },
        {
          "path": "doubleSided",
          "value": "true"
        },
        {
          "path": "backEnabled",
          "value": "false"
        },
        {
          "path": "backColor",
          "value": "#b9d49a"
        },
        {
          "path": "backTexture",
          "value": ""
        },
        {
          "path": "translucency",
          "value": "0.45"
        },
        {
          "path": "specular",
          "value": "0.25"
        },
        {
          "path": "specularShininess",
          "value": "28"
        },
        {
          "path": "specularColor",
          "value": "#ffffff"
        },
        {
          "path": "scatter",
          "value": "0"
        },
        {
          "path": "scatterPower",
          "value": "2"
        },
        {
          "path": "emissive",
          "value": "0"
        },
        {
          "path": "emissiveColor",
          "value": "#ffffff"
        },
        {
          "path": "normalFromAlbedo",
          "value": "0.8"
        },
        {
          "path": "normalScale",
          "value": "1"
        },
        {
          "path": "texture",
          "value": ""
        },
        {
          "path": "textureU",
          "value": "0"
        },
        {
          "path": "textureV",
          "value": "0"
        },
        {
          "path": "textureRepeatU",
          "value": "1"
        },
        {
          "path": "textureRepeatV",
          "value": "1"
        },
        {
          "path": "textureRotation",
          "value": "0"
        },
        {
          "path": "normalTexture",
          "value": ""
        }
      ]
    },
    {
      "id": "custom",
      "name": "custom",
      "fields": [
        {
          "path": "enabled",
          "value": "true"
        },
        {
          "path": "vertex",
          "value": "// 可用: position / transformed / normal / uv / uTime / uSeed / aWind\n// transformed.xz += sin(uTime + position.y) * 0.05;"
        },
        {
          "path": "fragment",
          "value": "// 可用: diffuseColor / vTreeUv / vColor(需用 .rgb) / uTime / uSeed\n// diffuseColor.rgb *= 0.9 + 0.1 * sin(uTime + vTreeUv.y * 10.0);"
        }
      ]
    },
    {
      "id": "wind",
      "name": "wind",
      "fields": [
        {
          "path": "enabled",
          "value": "true"
        },
        {
          "path": "auto",
          "value": "true"
        },
        {
          "path": "intensity",
          "value": "0.3"
        },
        {
          "path": "direction",
          "value": "45"
        },
        {
          "path": "strength",
          "value": "0.15"
        },
        {
          "path": "speed",
          "value": "0.8"
        },
        {
          "path": "frequency",
          "value": "1"
        },
        {
          "path": "gust",
          "value": "0.5"
        },
        {
          "path": "gustSpeed",
          "value": "0.16"
        },
        {
          "path": "turbulence",
          "value": "0.12"
        },
        {
          "path": "spatialScale",
          "value": "0.22"
        },
        {
          "path": "bias",
          "value": "0.3"
        },
        {
          "path": "flexFalloff",
          "value": "1.5"
        },
        {
          "path": "barkSway",
          "value": "0.6"
        },
        {
          "path": "leafFlutter",
          "value": "0.6"
        },
        {
          "path": "leafTwist",
          "value": "0.5"
        },
        {
          "path": "timeScale",
          "value": "1"
        }
      ]
    },
    {
      "id": "growth",
      "name": "growth",
      "fields": [
        {
          "path": "enabled",
          "value": "true"
        },
        {
          "path": "value",
          "value": "1"
        },
        {
          "path": "auto",
          "value": "true"
        },
        {
          "path": "speed",
          "value": "0.35"
        }
      ]
    },
    {
      "id": "exportOptions",
      "name": "exportOptions",
      "fields": [
        {
          "path": "mergeBark",
          "value": "false"
        }
      ]
    },
    {
      "id": "scene",
      "name": "scene",
      "fields": [
        {
          "path": "env",
          "value": "custom"
        },
        {
          "path": "background",
          "value": "#111820"
        },
        {
          "path": "skyTop",
          "value": "#2a3c52"
        },
        {
          "path": "skyBottom",
          "value": "#111820"
        },
        {
          "path": "gradient",
          "value": "true"
        },
        {
          "path": "ground",
          "value": "true"
        },
        {
          "path": "groundColor",
          "value": "#262b34"
        },
        {
          "path": "grid",
          "value": "true"
        },
        {
          "path": "wireframe",
          "value": "off"
        },
        {
          "path": "fog",
          "value": "true"
        },
        {
          "path": "fogColor",
          "value": "#111820"
        },
        {
          "path": "fogScale",
          "value": "1"
        },
        {
          "path": "shadows",
          "value": "true"
        },
        {
          "path": "dynamicShadows",
          "value": "true"
        },
        {
          "path": "skeletonOnly",
          "value": "false"
        },
        {
          "path": "sunColor",
          "value": "#fff2e0"
        },
        {
          "path": "sunAzimuth",
          "value": "35"
        },
        {
          "path": "sunElevation",
          "value": "40"
        },
        {
          "path": "sunIntensity",
          "value": "3.3"
        },
        {
          "path": "ambient",
          "value": "1.05"
        },
        {
          "path": "exposure",
          "value": "1.25"
        },
        {
          "path": "hemiSky",
          "value": "#c8dcff"
        },
        {
          "path": "hemiGround",
          "value": "#3a2f24"
        },
        {
          "path": "stars",
          "value": "0"
        },
        {
          "path": "autoRotate",
          "value": "false"
        }
      ]
    },
    {
      "id": "lod",
      "name": "lod",
      "fields": [
        {
          "path": "barkDetail",
          "value": "1"
        },
        {
          "path": "leafRatio",
          "value": "1"
        },
        {
          "path": "maxLeaves",
          "value": "60000"
        },
        {
          "path": "dynamic",
          "value": "true"
        },
        {
          "path": "distance1",
          "value": "2.2"
        },
        {
          "path": "distance2",
          "value": "4.5"
        },
        {
          "path": "keep1",
          "value": "0.3"
        },
        {
          "path": "keep2",
          "value": "0.08"
        },
        {
          "path": "force",
          "value": "auto"
        }
      ]
    },
    {
      "id": "ao",
      "name": "ao",
      "fields": [
        {
          "path": "enabled",
          "value": "true"
        },
        {
          "path": "strength",
          "value": "0.55"
        },
        {
          "path": "radius",
          "value": "0.9"
        }
      ]
    }
  ],
  "modules": [
    {
      "id": "ambientOcclusion",
      "name": "ambientOcclusion",
      "title": "环境光遮蔽",
      "category": "几何生成",
      "file": "src/core/ambientOcclusion.js",
      "functions": [
        {
          "id": "ambientOcclusion:buildOcclusionGrid",
          "name": "buildOcclusionGrid",
          "module": "ambientOcclusion",
          "line": 76,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "ambientOcclusion:occlusionAt",
          "name": "occlusionAt",
          "module": "ambientOcclusion",
          "line": 163,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "ambientOcclusion:percentile",
          "name": "percentile",
          "module": "ambientOcclusion",
          "line": 201,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "ambientOcclusion:bakeOcclusion",
          "name": "bakeOcclusion",
          "module": "ambientOcclusion",
          "line": 225,
          "exported": true,
          "parent": null,
          "calls": [
            "ambientOcclusion:occlusionAt",
            "ambientOcclusion:percentile"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "ambientOcclusion:bakeOcclusionByRanges",
          "name": "bakeOcclusionByRanges",
          "module": "ambientOcclusion",
          "line": 289,
          "exported": true,
          "parent": null,
          "calls": [
            "ambientOcclusion:occlusionAt",
            "ambientOcclusion:percentile"
          ],
          "externalCalls": [],
          "paramRefs": []
        }
      ]
    },
    {
      "id": "apiRegistry",
      "name": "apiRegistry",
      "title": "接口注册",
      "category": "应用与接口",
      "file": "src/core/apiRegistry.js",
      "functions": [
        {
          "id": "apiRegistry:toolsForMcp",
          "name": "toolsForMcp",
          "module": "apiRegistry",
          "line": 150,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        }
      ]
    },
    {
      "id": "appApi",
      "name": "appApi",
      "title": "应用接口",
      "category": "应用与接口",
      "file": "src/core/appApi.js",
      "functions": [
        {
          "id": "appApi:pathExists",
          "name": "pathExists",
          "module": "appApi",
          "line": 59,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "appApi:setAt",
          "name": "setAt",
          "module": "appApi",
          "line": 72,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "appApi:runCommand",
          "name": "runCommand",
          "module": "appApi",
          "line": 676,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "appApi:TAB_ID",
          "name": "TAB_ID",
          "module": "appApi",
          "line": 704,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "appApi:bridgeStatus",
          "name": "bridgeStatus",
          "module": "appApi",
          "line": 719,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "appApi:bridgeConsumerId",
          "name": "bridgeConsumerId",
          "module": "appApi",
          "line": 727,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "appApi:registerConsumer",
          "name": "registerConsumer",
          "module": "appApi",
          "line": 738,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "appApi:startBridgeClient",
          "name": "startBridgeClient",
          "module": "appApi",
          "line": 779,
          "exported": true,
          "parent": null,
          "calls": [
            "appApi:registerConsumer",
            "appApi:runCommand"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "appApi:stopBridgeClient",
          "name": "stopBridgeClient",
          "module": "appApi",
          "line": 820,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        }
      ]
    },
    {
      "id": "autowind",
      "name": "autowind",
      "title": "自动风",
      "category": "场景与风",
      "file": "src/core/autowind.js",
      "functions": [
        {
          "id": "autowind:autoWind",
          "name": "autoWind",
          "module": "autowind",
          "line": 39,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [
            "rng"
          ],
          "paramRefs": []
        }
      ]
    },
    {
      "id": "barkSkeleton",
      "name": "barkSkeleton",
      "title": "树皮骨架",
      "category": "几何生成",
      "file": "src/core/barkSkeleton.js",
      "functions": [
        {
          "id": "barkSkeleton:createBarkSkeleton",
          "name": "createBarkSkeleton",
          "module": "barkSkeleton",
          "line": 45,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "barkSkeleton:addBarkBranch",
          "name": "addBarkBranch",
          "module": "barkSkeleton",
          "line": 75,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "barkSkeleton:projectOnSegment",
          "name": "projectOnSegment",
          "module": "barkSkeleton",
          "line": 157,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "barkSkeleton:finalizeBarkSkeleton",
          "name": "finalizeBarkSkeleton",
          "module": "barkSkeleton",
          "line": 189,
          "exported": true,
          "parent": null,
          "calls": [
            "barkSkeleton:projectOnSegment"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "barkSkeleton:enforceChildBranchRadii",
          "name": "enforceChildBranchRadii",
          "module": "barkSkeleton",
          "line": 262,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        }
      ]
    },
    {
      "id": "barkSkin",
      "name": "barkSkin",
      "title": "树皮蒙皮",
      "category": "几何生成",
      "file": "src/core/barkSkin.js",
      "functions": [
        {
          "id": "barkSkin:smoothstep01",
          "name": "smoothstep01",
          "module": "barkSkin",
          "line": 63,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "barkSkin:rgb",
          "name": "rgb",
          "module": "barkSkin",
          "line": 73,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "barkSkin:vec3",
          "name": "vec3",
          "module": "barkSkin",
          "line": 85,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [
            "mathUtils"
          ],
          "paramRefs": []
        },
        {
          "id": "barkSkin:baseRadialSegments",
          "name": "baseRadialSegments",
          "module": "barkSkin",
          "line": 102,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "barkSkin:ringModifier",
          "name": "ringModifier",
          "module": "barkSkin",
          "line": 127,
          "exported": false,
          "parent": null,
          "calls": [
            "barkSkin:smoothstep01"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "barkSkin:averageRingRadius",
          "name": "averageRingRadius",
          "module": "barkSkin",
          "line": 170,
          "exported": false,
          "parent": null,
          "calls": [
            "barkSkin:ringModifier"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "barkSkin:childBaseRadius",
          "name": "childBaseRadius",
          "module": "barkSkin",
          "line": 188,
          "exported": false,
          "parent": null,
          "calls": [
            "barkSkin:ringModifier"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "barkSkin:buildRingBases",
          "name": "buildRingBases",
          "module": "barkSkin",
          "line": 210,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [
            "mathUtils"
          ],
          "paramRefs": []
        },
        {
          "id": "barkSkin:planBranchWindows",
          "name": "planBranchWindows",
          "module": "barkSkin",
          "line": 266,
          "exported": false,
          "parent": null,
          "calls": [
            "barkSkin:baseRadialSegments",
            "barkSkin:averageRingRadius",
            "barkSkin:buildGroups",
            "barkSkin:requiredM",
            "barkSkin:placeWindows"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "barkSkin:buildGroups",
          "name": "buildGroups",
          "module": "barkSkin",
          "line": 311,
          "exported": false,
          "parent": "barkSkin:planBranchWindows",
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "barkSkin:requiredM",
          "name": "requiredM",
          "module": "barkSkin",
          "line": 322,
          "exported": false,
          "parent": "barkSkin:planBranchWindows",
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "barkSkin:placeWindows",
          "name": "placeWindows",
          "module": "barkSkin",
          "line": 467,
          "exported": false,
          "parent": null,
          "calls": [
            "barkSkin:rangeFree",
            "barkSkin:colFree",
            "barkSkin:mark"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "barkSkin:getOcc",
          "name": "getOcc",
          "module": "barkSkin",
          "line": 471,
          "exported": false,
          "parent": "barkSkin:placeWindows",
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "barkSkin:colFree",
          "name": "colFree",
          "module": "barkSkin",
          "line": 476,
          "exported": false,
          "parent": "barkSkin:placeWindows",
          "calls": [
            "barkSkin:getOcc"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "barkSkin:mark",
          "name": "mark",
          "module": "barkSkin",
          "line": 480,
          "exported": false,
          "parent": "barkSkin:placeWindows",
          "calls": [
            "barkSkin:getOcc"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "barkSkin:rangeFree",
          "name": "rangeFree",
          "module": "barkSkin",
          "line": 484,
          "exported": false,
          "parent": "barkSkin:placeWindows",
          "calls": [
            "barkSkin:colFree"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "barkSkin:sampleLoopVertex",
          "name": "sampleLoopVertex",
          "module": "barkSkin",
          "line": 547,
          "exported": false,
          "parent": null,
          "calls": [
            "barkSkin:readVertex",
            "barkSkin:closedParams",
            "barkSkin:distanceBetween",
            "barkSkin:mixVertex"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "barkSkin:readVertex",
          "name": "readVertex",
          "module": "barkSkin",
          "line": 571,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "barkSkin:mixVertex",
          "name": "mixVertex",
          "module": "barkSkin",
          "line": 601,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "barkSkin:buildCollarLoop",
          "name": "buildCollarLoop",
          "module": "barkSkin",
          "line": 639,
          "exported": false,
          "parent": null,
          "calls": [
            "barkSkin:sampleLoopVertex",
            "barkSkin:mixVertex"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "barkSkin:stitchLoops",
          "name": "stitchLoops",
          "module": "barkSkin",
          "line": 676,
          "exported": false,
          "parent": null,
          "calls": [
            "barkSkin:closedParams"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "barkSkin:closedParams",
          "name": "closedParams",
          "module": "barkSkin",
          "line": 713,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "barkSkin:childAttachT",
          "name": "childAttachT",
          "module": "barkSkin",
          "line": 743,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "barkSkin:sampleSkinFrame",
          "name": "sampleSkinFrame",
          "module": "barkSkin",
          "line": 763,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "barkSkin:findBandAt",
          "name": "findBandAt",
          "module": "barkSkin",
          "line": 791,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "barkSkin:buildSkinFrames",
          "name": "buildSkinFrames",
          "module": "barkSkin",
          "line": 821,
          "exported": false,
          "parent": null,
          "calls": [
            "barkSkin:childAttachT",
            "barkSkin:childBaseRadius",
            "barkSkin:sampleSkinFrame"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "barkSkin:buildBarkSkin",
          "name": "buildBarkSkin",
          "module": "barkSkin",
          "line": 912,
          "exported": true,
          "parent": null,
          "calls": [
            "barkSkin:buildSkinFrames",
            "barkSkin:buildRingBases",
            "barkSkin:childAttachT",
            "barkSkin:findBandAt",
            "barkSkin:childBaseRadius",
            "barkSkin:planBranchWindows",
            "barkSkin:baseRadialSegments",
            "barkSkin:rgb",
            "barkSkin:vec3",
            "barkSkin:ringModifier",
            "barkSkin:bestRotation",
            "barkSkin:buildCollarLoop",
            "barkSkin:stitchLoops",
            "barkSkin:distanceBetween"
          ],
          "externalCalls": [
            "meshTopology",
            "mathUtils"
          ],
          "paramRefs": [
            "lod:barkDetail"
          ]
        },
        {
          "id": "barkSkin:bestRotation",
          "name": "bestRotation",
          "module": "barkSkin",
          "line": 1335,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "barkSkin:distanceBetween",
          "name": "distanceBetween",
          "module": "barkSkin",
          "line": 1362,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        }
      ]
    },
    {
      "id": "barkTextures",
      "name": "barkTextures",
      "title": "树皮贴图",
      "category": "材质与贴图",
      "file": "src/core/barkTextures.js",
      "functions": [
        {
          "id": "barkTextures:pad2",
          "name": "pad2",
          "module": "barkTextures",
          "line": 58,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "barkTextures:barkTextureUrl",
          "name": "barkTextureUrl",
          "module": "barkTextures",
          "line": 74,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "barkTextures:barkTexturesFor",
          "name": "barkTexturesFor",
          "module": "barkTextures",
          "line": 125,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "barkTextures:barkTextureRows",
          "name": "barkTextureRows",
          "module": "barkTextures",
          "line": 136,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        }
      ]
    },
    {
      "id": "environments",
      "name": "environments",
      "title": "环境",
      "category": "材质与贴图",
      "file": "src/core/environments.js",
      "functions": [
        {
          "id": "environments:envById",
          "name": "envById",
          "module": "environments",
          "line": 343,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "environments:applyEnvironment",
          "name": "applyEnvironment",
          "module": "environments",
          "line": 360,
          "exported": true,
          "parent": null,
          "calls": [
            "environments:envById"
          ],
          "externalCalls": [],
          "paramRefs": []
        }
      ]
    },
    {
      "id": "exporter",
      "name": "exporter",
      "title": "GLB 导出",
      "category": "导出与统计",
      "file": "src/core/exporter.js",
      "functions": [
        {
          "id": "exporter:downloadBlob",
          "name": "downloadBlob",
          "module": "exporter",
          "line": 40,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "exporter:downloadText",
          "name": "downloadText",
          "module": "exporter",
          "line": 57,
          "exported": true,
          "parent": null,
          "calls": [
            "exporter:downloadBlob"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "exporter:exportGLB",
          "name": "exportGLB",
          "module": "exporter",
          "line": 97,
          "exported": true,
          "parent": null,
          "calls": [
            "exporter:restoreAll",
            "exporter:downloadBlob"
          ],
          "externalCalls": [
            "textureNaming"
          ],
          "paramRefs": []
        },
        {
          "id": "exporter:restoreAll",
          "name": "restoreAll",
          "module": "exporter",
          "line": 107,
          "exported": false,
          "parent": "exporter:exportGLB",
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "exporter:expandExponentialNumbers",
          "name": "expandExponentialNumbers",
          "module": "exporter",
          "line": 158,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "exporter:exportOBJ",
          "name": "exportOBJ",
          "module": "exporter",
          "line": 180,
          "exported": true,
          "parent": null,
          "calls": [
            "exporter:expandExponentialNumbers",
            "exporter:downloadText"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "exporter:buildParamsJSON",
          "name": "buildParamsJSON",
          "module": "exporter",
          "line": 201,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": [
            "seed:*"
          ]
        },
        {
          "id": "exporter:exportParamsJSON",
          "name": "exportParamsJSON",
          "module": "exporter",
          "line": 217,
          "exported": true,
          "parent": null,
          "calls": [
            "exporter:buildParamsJSON",
            "exporter:downloadText"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "exporter:exportScreenshot",
          "name": "exportScreenshot",
          "module": "exporter",
          "line": 232,
          "exported": true,
          "parent": null,
          "calls": [
            "exporter:downloadBlob"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "exporter:readTextFile",
          "name": "readTextFile",
          "module": "exporter",
          "line": 242,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "exporter:readImageAsDataURL",
          "name": "readImageAsDataURL",
          "module": "exporter",
          "line": 253,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        }
      ]
    },
    {
      "id": "exportPreview",
      "name": "exportPreview",
      "title": "导出预览",
      "category": "导出与统计",
      "file": "src/core/exportPreview.js",
      "functions": [
        {
          "id": "exportPreview:formatFileSize",
          "name": "formatFileSize",
          "module": "exportPreview",
          "line": 34,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "exportPreview:triangleCount",
          "name": "triangleCount",
          "module": "exportPreview",
          "line": 48,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "exportPreview:vertexCount",
          "name": "vertexCount",
          "module": "exportPreview",
          "line": 58,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "exportPreview:exportNodeList",
          "name": "exportNodeList",
          "module": "exportPreview",
          "line": 69,
          "exported": true,
          "parent": null,
          "calls": [
            "exportPreview:triangleCount",
            "exportPreview:vertexCount"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "exportPreview:parseGLB",
          "name": "parseGLB",
          "module": "exportPreview",
          "line": 100,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "exportPreview:imageNameLookup",
          "name": "imageNameLookup",
          "module": "exportPreview",
          "line": 132,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "exportPreview:extForMime",
          "name": "extForMime",
          "module": "exportPreview",
          "line": 145,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "exportPreview:glbImageArtifacts",
          "name": "glbImageArtifacts",
          "module": "exportPreview",
          "line": 167,
          "exported": true,
          "parent": null,
          "calls": [
            "exportPreview:imageNameLookup",
            "exportPreview:extForMime"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "exportPreview:buildGLBPreview",
          "name": "buildGLBPreview",
          "module": "exportPreview",
          "line": 223,
          "exported": true,
          "parent": null,
          "calls": [
            "exportPreview:exportNodeList",
            "exporter:exportGLB",
            "exportPreview:parseGLB",
            "exportPreview:glbImageArtifacts"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "exportPreview:buildOBJPreview",
          "name": "buildOBJPreview",
          "module": "exportPreview",
          "line": 259,
          "exported": true,
          "parent": null,
          "calls": [
            "exportPreview:exportNodeList",
            "exporter:exportOBJ"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "exportPreview:buildPNGPreview",
          "name": "buildPNGPreview",
          "module": "exportPreview",
          "line": 284,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        }
      ]
    },
    {
      "id": "exportSplit",
      "name": "exportSplit",
      "title": "导出拆分",
      "category": "导出与统计",
      "file": "src/core/exportSplit.js",
      "functions": [
        {
          "id": "exportSplit:barkGroupName",
          "name": "barkGroupName",
          "module": "exportSplit",
          "line": 63,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "exportSplit:barkExportParts",
          "name": "barkExportParts",
          "module": "exportSplit",
          "line": 87,
          "exported": true,
          "parent": null,
          "calls": [
            "exportSplit:splitBarkGeometryByNodeGroups"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "exportSplit:splitBarkGeometryByNodeGroups",
          "name": "splitBarkGeometryByNodeGroups",
          "module": "exportSplit",
          "line": 111,
          "exported": true,
          "parent": null,
          "calls": [
            "exportSplit:labelOf",
            "exportSplit:ensureGroup",
            "exportSplit:order"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "exportSplit:labelOf",
          "name": "labelOf",
          "module": "exportSplit",
          "line": 119,
          "exported": false,
          "parent": "exportSplit:splitBarkGeometryByNodeGroups",
          "calls": [
            "exportSplit:barkGroupName"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "exportSplit:ensureGroup",
          "name": "ensureGroup",
          "module": "exportSplit",
          "line": 142,
          "exported": false,
          "parent": "exportSplit:splitBarkGeometryByNodeGroups",
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "exportSplit:order",
          "name": "order",
          "module": "exportSplit",
          "line": 181,
          "exported": false,
          "parent": "exportSplit:splitBarkGeometryByNodeGroups",
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        }
      ]
    },
    {
      "id": "fallingLeaves",
      "name": "fallingLeaves",
      "title": "落叶",
      "category": "场景与风",
      "file": "src/core/fallingLeaves.js",
      "functions": [
        {
          "id": "fallingLeaves:fallRebuildKey",
          "name": "fallRebuildKey",
          "module": "fallingLeaves",
          "line": 190,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": [
            "fall:*",
            "leafMat:*",
            "leaves:*"
          ]
        },
        {
          "id": "fallingLeaves:effectUniforms",
          "name": "effectUniforms",
          "module": "fallingLeaves",
          "line": 223,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [
            "leafEffects",
            "rng"
          ],
          "paramRefs": []
        },
        {
          "id": "fallingLeaves:writeEffectUniforms",
          "name": "writeEffectUniforms",
          "module": "fallingLeaves",
          "line": 244,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [
            "leafEffects"
          ],
          "paramRefs": []
        },
        {
          "id": "fallingLeaves:buildFallingLeaves",
          "name": "buildFallingLeaves",
          "module": "fallingLeaves",
          "line": 273,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [
            "particles",
            "leafTexture",
            "rng"
          ],
          "paramRefs": [
            "fall:*",
            "seed:*",
            "leaves:*"
          ]
        },
        {
          "id": "fallingLeaves:updateFallingLeaves",
          "name": "updateFallingLeaves",
          "module": "fallingLeaves",
          "line": 404,
          "exported": true,
          "parent": null,
          "calls": [
            "fallingLeaves:writeEffectUniforms"
          ],
          "externalCalls": [],
          "paramRefs": [
            "fall:*"
          ]
        }
      ]
    },
    {
      "id": "forceField",
      "name": "forceField",
      "title": "力场",
      "category": "几何生成",
      "file": "src/core/forceField.js",
      "functions": [
        {
          "id": "forceField:clamp",
          "name": "clamp",
          "module": "forceField",
          "line": 34,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "forceField:defaultForceItem",
          "name": "defaultForceItem",
          "module": "forceField",
          "line": 44,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "forceField:normalizeForceItem",
          "name": "normalizeForceItem",
          "module": "forceField",
          "line": 71,
          "exported": true,
          "parent": null,
          "calls": [
            "forceField:clamp"
          ],
          "externalCalls": [],
          "paramRefs": [
            "fruit:type",
            "leaves:shape",
            "leaves:size"
          ]
        },
        {
          "id": "forceField:normalizeForces",
          "name": "normalizeForces",
          "module": "forceField",
          "line": 107,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": [
            "forces:items",
            "branches:enabled",
            "forces:showHelpers"
          ]
        },
        {
          "id": "forceField:rotationMatrix",
          "name": "rotationMatrix",
          "module": "forceField",
          "line": 126,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "forceField:shapeField",
          "name": "shapeField",
          "module": "forceField",
          "line": 154,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "forceField:createForceField",
          "name": "createForceField",
          "module": "forceField",
          "line": 248,
          "exported": true,
          "parent": null,
          "calls": [
            "forceField:normalizeForces",
            "forceField:rotationMatrix"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "forceField:apply",
          "name": "apply",
          "module": "forceField",
          "line": 260,
          "exported": false,
          "parent": "forceField:createForceField",
          "calls": [
            "forceField:shapeField"
          ],
          "externalCalls": [],
          "paramRefs": []
        }
      ]
    },
    {
      "id": "fruit",
      "name": "fruit",
      "title": "果实",
      "category": "几何生成",
      "file": "src/core/fruit.js",
      "functions": [
        {
          "id": "fruit:lathe",
          "name": "lathe",
          "module": "fruit",
          "line": 27,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "fruit:buildFruitTemplate",
          "name": "buildFruitTemplate",
          "module": "fruit",
          "line": 85,
          "exported": true,
          "parent": null,
          "calls": [
            "fruit:lathe"
          ],
          "externalCalls": [],
          "paramRefs": [
            "fruit:type",
            "fruit:radial",
            "leaves:color",
            "fruit:capColor"
          ]
        },
        {
          "id": "fruit:pushFruitInstance",
          "name": "pushFruitInstance",
          "module": "fruit",
          "line": 235,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": [
            "bark:scale",
            "wind:*"
          ]
        }
      ]
    },
    {
      "id": "fruitMaterial",
      "name": "fruitMaterial",
      "title": "果实材质",
      "category": "几何生成",
      "file": "src/core/fruitMaterial.js",
      "functions": [
        {
          "id": "fruitMaterial:makeCanvas",
          "name": "makeCanvas",
          "module": "fruitMaterial",
          "line": 41,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "fruitMaterial:makeDetailPixels",
          "name": "makeDetailPixels",
          "module": "fruitMaterial",
          "line": 69,
          "exported": false,
          "parent": null,
          "calls": [
            "fruitMaterial:makeCanvas"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "fruitMaterial:makeDiffuseTexture",
          "name": "makeDiffuseTexture",
          "module": "fruitMaterial",
          "line": 149,
          "exported": false,
          "parent": null,
          "calls": [
            "fruitMaterial:makeCanvas"
          ],
          "externalCalls": [
            "rng"
          ],
          "paramRefs": []
        },
        {
          "id": "fruitMaterial:makeAlphaMaskDataUrl",
          "name": "makeAlphaMaskDataUrl",
          "module": "fruitMaterial",
          "line": 207,
          "exported": false,
          "parent": null,
          "calls": [
            "fruitMaterial:makeCanvas"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "fruitMaterial:createFruitExportMaterial",
          "name": "createFruitExportMaterial",
          "module": "fruitMaterial",
          "line": 265,
          "exported": true,
          "parent": null,
          "calls": [
            "fruitMaterial:makeDetailPixels",
            "fruitMaterial:makeDiffuseTexture",
            "fruitMaterial:makeAlphaMaskDataUrl"
          ],
          "externalCalls": [
            "textureNaming",
            "rng"
          ],
          "paramRefs": []
        },
        {
          "id": "fruitMaterial:disposeFruitExportMaterial",
          "name": "disposeFruitExportMaterial",
          "module": "fruitMaterial",
          "line": 304,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        }
      ]
    },
    {
      "id": "ftree",
      "name": "ftree",
      "title": "工程文件",
      "category": "参数与预设",
      "file": "src/core/ftree.js",
      "functions": [
        {
          "id": "ftree:getAt",
          "name": "getAt",
          "module": "ftree",
          "line": 38,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "ftree:setAt",
          "name": "setAt",
          "module": "ftree",
          "line": 41,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "ftree:parseDataUrl",
          "name": "parseDataUrl",
          "module": "ftree",
          "line": 57,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "ftree:base64ToBytes",
          "name": "base64ToBytes",
          "module": "ftree",
          "line": 70,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "ftree:bytesToBase64",
          "name": "bytesToBase64",
          "module": "ftree",
          "line": 78,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "ftree:extractTextures",
          "name": "extractTextures",
          "module": "ftree",
          "line": 96,
          "exported": true,
          "parent": null,
          "calls": [
            "ftree:getAt",
            "ftree:parseDataUrl",
            "ftree:base64ToBytes",
            "ftree:setAt"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "ftree:injectTextures",
          "name": "injectTextures",
          "module": "ftree",
          "line": 118,
          "exported": true,
          "parent": null,
          "calls": [
            "ftree:setAt"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "ftree:buildFtree",
          "name": "buildFtree",
          "module": "ftree",
          "line": 139,
          "exported": true,
          "parent": null,
          "calls": [
            "ftree:extractTextures"
          ],
          "externalCalls": [
            "params"
          ],
          "paramRefs": []
        },
        {
          "id": "ftree:exportFtree",
          "name": "exportFtree",
          "module": "ftree",
          "line": 163,
          "exported": true,
          "parent": null,
          "calls": [
            "ftree:buildFtree",
            "exporter:downloadBlob"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "ftree:parseFtree",
          "name": "parseFtree",
          "module": "ftree",
          "line": 177,
          "exported": true,
          "parent": null,
          "calls": [
            "ftree:injectTextures"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "ftree:loadFtreeFile",
          "name": "loadFtreeFile",
          "module": "ftree",
          "line": 205,
          "exported": true,
          "parent": null,
          "calls": [
            "ftree:parseFtree"
          ],
          "externalCalls": [],
          "paramRefs": []
        }
      ]
    },
    {
      "id": "impostor",
      "name": "impostor",
      "title": "Impostor",
      "category": "导出与统计",
      "file": "src/core/impostor.js",
      "functions": [
        {
          "id": "impostor:viewAngles",
          "name": "viewAngles",
          "module": "impostor",
          "line": 48,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "impostor:elevationAngles",
          "name": "elevationAngles",
          "module": "impostor",
          "line": 65,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "impostor:atlasLayout",
          "name": "atlasLayout",
          "module": "impostor",
          "line": 81,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "impostor:crossCardQuads",
          "name": "crossCardQuads",
          "module": "impostor",
          "line": 97,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "impostor:alphaCoverage",
          "name": "alphaCoverage",
          "module": "impostor",
          "line": 115,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "impostor:pixelsToImageData",
          "name": "pixelsToImageData",
          "module": "impostor",
          "line": 131,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "impostor:renderView",
          "name": "renderView",
          "module": "impostor",
          "line": 144,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "impostor:generateImpostor",
          "name": "generateImpostor",
          "module": "impostor",
          "line": 214,
          "exported": true,
          "parent": null,
          "calls": [
            "impostor:addLight",
            "impostor:crossCardQuads",
            "impostor:viewAngles",
            "impostor:elevationAngles",
            "impostor:renderView",
            "impostor:alphaCoverage",
            "impostor:pixelsToImageData"
          ],
          "externalCalls": [],
          "paramRefs": [
            "leaves:size"
          ]
        },
        {
          "id": "impostor:addLight",
          "name": "addLight",
          "module": "impostor",
          "line": 254,
          "exported": false,
          "parent": "impostor:generateImpostor",
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        }
      ]
    },
    {
      "id": "leaf",
      "name": "leaf",
      "title": "树叶几何",
      "category": "几何生成",
      "file": "src/core/leaf.js",
      "functions": [
        {
          "id": "leaf:buildLeafCardTemplate",
          "name": "buildLeafCardTemplate",
          "module": "leaf",
          "line": 124,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": [
            "leaves:curl",
            "leaves:fold"
          ]
        },
        {
          "id": "leaf:buildLeafTemplate",
          "name": "buildLeafTemplate",
          "module": "leaf",
          "line": 182,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": [
            "leaves:shape",
            "branches:segments",
            "leaves:curl",
            "leaves:fold",
            "leaves:petiole"
          ]
        },
        {
          "id": "leaf:pushLeafInstance",
          "name": "pushLeafInstance",
          "module": "leaf",
          "line": 259,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        }
      ]
    },
    {
      "id": "leafEffects",
      "name": "leafEffects",
      "title": "叶片特效",
      "category": "几何生成",
      "file": "src/core/leafEffects.js",
      "functions": [
        {
          "id": "leafEffects:resolveLeafEffects",
          "name": "resolveLeafEffects",
          "module": "leafEffects",
          "line": 38,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": [
            "flower:*",
            "leafMat:*"
          ]
        }
      ]
    },
    {
      "id": "leafTexture",
      "name": "leafTexture",
      "title": "叶纹理",
      "category": "几何生成",
      "file": "src/core/leafTexture.js",
      "functions": [
        {
          "id": "leafTexture:ellipseLeafTexture",
          "name": "ellipseLeafTexture",
          "module": "leafTexture",
          "line": 39,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [
            "leafCards.generated"
          ],
          "paramRefs": []
        },
        {
          "id": "leafTexture:cardTexture",
          "name": "cardTexture",
          "module": "leafTexture",
          "line": 75,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [
            "leafCards.generated"
          ],
          "paramRefs": []
        },
        {
          "id": "leafTexture:resolveEffectTexture",
          "name": "resolveEffectTexture",
          "module": "leafTexture",
          "line": 96,
          "exported": true,
          "parent": null,
          "calls": [
            "leafTexture:cardTexture",
            "leafTexture:ellipseLeafTexture"
          ],
          "externalCalls": [],
          "paramRefs": [
            "flower:cardId"
          ]
        },
        {
          "id": "leafTexture:resolveEffectAspect",
          "name": "resolveEffectAspect",
          "module": "leafTexture",
          "line": 107,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        }
      ]
    },
    {
      "id": "litter",
      "name": "litter",
      "title": "地表落叶",
      "category": "场景与风",
      "file": "src/core/litter.js",
      "functions": [
        {
          "id": "litter:effectUniforms",
          "name": "effectUniforms",
          "module": "litter",
          "line": 102,
          "exported": false,
          "parent": null,
          "calls": [
            "leafEffects:resolveLeafEffects"
          ],
          "externalCalls": [
            "rng"
          ],
          "paramRefs": []
        },
        {
          "id": "litter:updateLitterEffects",
          "name": "updateLitterEffects",
          "module": "litter",
          "line": 126,
          "exported": true,
          "parent": null,
          "calls": [
            "leafEffects:resolveLeafEffects"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "litter:litterRebuildKey",
          "name": "litterRebuildKey",
          "module": "litter",
          "line": 145,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": [
            "litter:*",
            "leafMat:*",
            "leaves:*"
          ]
        },
        {
          "id": "litter:buildLeafLitter",
          "name": "buildLeafLitter",
          "module": "litter",
          "line": 172,
          "exported": true,
          "parent": null,
          "calls": [
            "leafTexture:resolveEffectAspect",
            "leafTexture:resolveEffectTexture"
          ],
          "externalCalls": [
            "rng"
          ],
          "paramRefs": [
            "litter:*",
            "seed:*",
            "leaves:*"
          ]
        }
      ]
    },
    {
      "id": "materialPreview",
      "name": "materialPreview",
      "title": "材质预览",
      "category": "材质与贴图",
      "file": "src/core/materialPreview.js",
      "functions": [
        {
          "id": "materialPreview:createMaterialPreview",
          "name": "createMaterialPreview",
          "module": "materialPreview",
          "line": 53,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [
            "materials"
          ],
          "paramRefs": []
        },
        {
          "id": "materialPreview:placeCamera",
          "name": "placeCamera",
          "module": "materialPreview",
          "line": 108,
          "exported": false,
          "parent": "materialPreview:createMaterialPreview",
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "materialPreview:render",
          "name": "render",
          "module": "materialPreview",
          "line": 119,
          "exported": false,
          "parent": "materialPreview:createMaterialPreview",
          "calls": [
            "materialPreview:placeCamera"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "materialPreview:scheduleRetries",
          "name": "scheduleRetries",
          "module": "materialPreview",
          "line": 132,
          "exported": false,
          "parent": "materialPreview:createMaterialPreview",
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "materialPreview:setParams",
          "name": "setParams",
          "module": "materialPreview",
          "line": 147,
          "exported": false,
          "parent": "materialPreview:createMaterialPreview",
          "calls": [
            "materialPreview:render",
            "materialPreview:scheduleRetries"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "materialPreview:onDown",
          "name": "onDown",
          "module": "materialPreview",
          "line": 167,
          "exported": false,
          "parent": "materialPreview:createMaterialPreview",
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "materialPreview:onMove",
          "name": "onMove",
          "module": "materialPreview",
          "line": 173,
          "exported": false,
          "parent": "materialPreview:createMaterialPreview",
          "calls": [
            "materialPreview:render"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "materialPreview:onUp",
          "name": "onUp",
          "module": "materialPreview",
          "line": 184,
          "exported": false,
          "parent": "materialPreview:createMaterialPreview",
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "materialPreview:dispose",
          "name": "dispose",
          "module": "materialPreview",
          "line": 199,
          "exported": false,
          "parent": "materialPreview:createMaterialPreview",
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "materialPreview:rotateBy",
          "name": "rotateBy",
          "module": "materialPreview",
          "line": 218,
          "exported": false,
          "parent": "materialPreview:createMaterialPreview",
          "calls": [
            "materialPreview:render"
          ],
          "externalCalls": [],
          "paramRefs": []
        }
      ]
    },
    {
      "id": "materials",
      "name": "materials",
      "title": "材质",
      "category": "材质与贴图",
      "file": "src/core/materials.js",
      "functions": [
        {
          "id": "materials:whitePixelTexture",
          "name": "whitePixelTexture",
          "module": "materials",
          "line": 56,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [
            "normalFromAlbedo"
          ],
          "paramRefs": []
        },
        {
          "id": "materials:vertexBody",
          "name": "vertexBody",
          "module": "materials",
          "line": 140,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "materials:fragmentBody",
          "name": "fragmentBody",
          "module": "materials",
          "line": 262,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "materials:internalShaderSources",
          "name": "internalShaderSources",
          "module": "materials",
          "line": 456,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "materials:resolveTintMix",
          "name": "resolveTintMix",
          "module": "materials",
          "line": 479,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "materials:applyAutoNormal",
          "name": "applyAutoNormal",
          "module": "materials",
          "line": 509,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [
            "textures"
          ],
          "paramRefs": [
            "flower:normalFromAlbedo",
            "flower:texture"
          ]
        },
        {
          "id": "materials:hashCode",
          "name": "hashCode",
          "module": "materials",
          "line": 568,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "materials:createSharedUniforms",
          "name": "createSharedUniforms",
          "module": "materials",
          "line": 590,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [
            "normalFromAlbedo"
          ],
          "paramRefs": []
        },
        {
          "id": "materials:perMaterialUniforms",
          "name": "perMaterialUniforms",
          "module": "materials",
          "line": 640,
          "exported": true,
          "parent": null,
          "calls": [
            "materials:resolveTintMix",
            "materials:whitePixelTexture"
          ],
          "externalCalls": [
            "normalFromAlbedo"
          ],
          "paramRefs": [
            "wind:*",
            "leafMat:*",
            "bark:*"
          ]
        },
        {
          "id": "materials:applyTreeShader",
          "name": "applyTreeShader",
          "module": "materials",
          "line": 699,
          "exported": false,
          "parent": null,
          "calls": [
            "materials:vertexBody",
            "materials:fragmentBody"
          ],
          "externalCalls": [],
          "paramRefs": [
            "flower:translucency"
          ]
        },
        {
          "id": "materials:createTreeDepthMaterial",
          "name": "createTreeDepthMaterial",
          "module": "materials",
          "line": 799,
          "exported": true,
          "parent": null,
          "calls": [
            "materials:vertexBody"
          ],
          "externalCalls": [
            "normalFromAlbedo"
          ],
          "paramRefs": []
        },
        {
          "id": "materials:createBarkMaterial",
          "name": "createBarkMaterial",
          "module": "materials",
          "line": 838,
          "exported": true,
          "parent": null,
          "calls": [
            "materials:perMaterialUniforms",
            "materials:applyTreeShader",
            "materials:updateBarkMaterial"
          ],
          "externalCalls": [
            "normalFromAlbedo"
          ],
          "paramRefs": [
            "bark:*",
            "custom:*"
          ]
        },
        {
          "id": "materials:flowerLeafParams",
          "name": "flowerLeafParams",
          "module": "materials",
          "line": 875,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": [
            "flower:*",
            "leafMat:*"
          ]
        },
        {
          "id": "materials:createFlowerMaterial",
          "name": "createFlowerMaterial",
          "module": "materials",
          "line": 927,
          "exported": true,
          "parent": null,
          "calls": [
            "materials:createLeafMaterial"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "materials:updateFlowerMaterial",
          "name": "updateFlowerMaterial",
          "module": "materials",
          "line": 944,
          "exported": true,
          "parent": null,
          "calls": [
            "materials:updateLeafMaterial",
            "materials:flowerLeafParams"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "materials:createLeafMaterial",
          "name": "createLeafMaterial",
          "module": "materials",
          "line": 964,
          "exported": true,
          "parent": null,
          "calls": [
            "materials:perMaterialUniforms",
            "materials:applyTreeShader",
            "materials:updateLeafMaterial"
          ],
          "externalCalls": [
            "normalFromAlbedo"
          ],
          "paramRefs": [
            "leafMat:*",
            "leafMat:doubleSided",
            "flower:alphaTest",
            "custom:*"
          ]
        },
        {
          "id": "materials:updateBarkMaterial",
          "name": "updateBarkMaterial",
          "module": "materials",
          "line": 1020,
          "exported": true,
          "parent": null,
          "calls": [
            "materials:clearAutoBarkTextures",
            "materials:applyAutoNormal"
          ],
          "externalCalls": [
            "textures"
          ],
          "paramRefs": [
            "bark:*",
            "wind:*",
            "bark:uvWarp",
            "bark:uvWarpScale",
            "flower:texture",
            "leaves:color",
            "bark:color2",
            "bark:bump",
            "flower:normalFromAlbedo",
            "bark:uvScaleU",
            "bark:uvScaleV"
          ]
        },
        {
          "id": "materials:clearAutoBarkTextures",
          "name": "clearAutoBarkTextures",
          "module": "materials",
          "line": 1112,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [
            "textures"
          ],
          "paramRefs": []
        },
        {
          "id": "materials:updateLeafMaterial",
          "name": "updateLeafMaterial",
          "module": "materials",
          "line": 1146,
          "exported": true,
          "parent": null,
          "calls": [
            "materials:resolveTintMix",
            "materials:whitePixelTexture",
            "materials:applyAutoNormal"
          ],
          "externalCalls": [
            "textures"
          ],
          "paramRefs": [
            "leafMat:*",
            "flower:alphaTest",
            "leafMat:doubleSided",
            "leafMat:backEnabled",
            "flower:emissiveColor",
            "flower:emissive",
            "flower:texture",
            "leaves:*",
            "flower:translucency",
            "flower:specular",
            "flower:specularShininess",
            "flower:specularColor",
            "flower:scatter",
            "flower:scatterPower",
            "wind:*",
            "leafMat:backColor",
            "leafMat:backTexture",
            "flower:textureU",
            "flower:textureV",
            "flower:textureRepeat",
            "flower:textureRepeatU",
            "flower:textureRepeatV",
            "flower:textureRotation"
          ]
        },
        {
          "id": "materials:updateWindUniforms",
          "name": "updateWindUniforms",
          "module": "materials",
          "line": 1305,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "materials:updateGrowthUniforms",
          "name": "updateGrowthUniforms",
          "module": "materials",
          "line": 1331,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "materials:updateMaterials",
          "name": "updateMaterials",
          "module": "materials",
          "line": 1348,
          "exported": true,
          "parent": null,
          "calls": [
            "materials:updateBarkMaterial",
            "materials:updateLeafMaterial",
            "materials:updateFlowerMaterial",
            "materials:updateWindUniforms"
          ],
          "externalCalls": [],
          "paramRefs": [
            "wind:*",
            "seed:*"
          ]
        },
        {
          "id": "materials:rebindCustomShader",
          "name": "rebindCustomShader",
          "module": "materials",
          "line": 1378,
          "exported": true,
          "parent": null,
          "calls": [
            "materials:applyTreeShader"
          ],
          "externalCalls": [],
          "paramRefs": [
            "custom:*"
          ]
        },
        {
          "id": "materials:invalidateTextureCaches",
          "name": "invalidateTextureCaches",
          "module": "materials",
          "line": 1398,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        }
      ]
    },
    {
      "id": "mathUtils",
      "name": "mathUtils",
      "title": "数学工具",
      "category": "几何生成",
      "file": "src/core/mathUtils.js",
      "functions": [
        {
          "id": "mathUtils:clamp01",
          "name": "clamp01",
          "module": "mathUtils",
          "line": 35,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "mathUtils:lerp",
          "name": "lerp",
          "module": "mathUtils",
          "line": 46,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "mathUtils:smoothstep",
          "name": "smoothstep",
          "module": "mathUtils",
          "line": 58,
          "exported": true,
          "parent": null,
          "calls": [
            "mathUtils:clamp01"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "mathUtils:organicNoise1",
          "name": "organicNoise1",
          "module": "mathUtils",
          "line": 75,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "mathUtils:organicRingNoise",
          "name": "organicRingNoise",
          "module": "mathUtils",
          "line": 94,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "mathUtils:anyPerp",
          "name": "anyPerp",
          "module": "mathUtils",
          "line": 113,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [
            "twist"
          ],
          "paramRefs": []
        },
        {
          "id": "mathUtils:rotateTowardUp",
          "name": "rotateTowardUp",
          "module": "mathUtils",
          "line": 132,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [
            "twist"
          ],
          "paramRefs": []
        },
        {
          "id": "mathUtils:azimuthPerp",
          "name": "azimuthPerp",
          "module": "mathUtils",
          "line": 151,
          "exported": true,
          "parent": null,
          "calls": [
            "mathUtils:anyPerp"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "mathUtils:sampleFrame",
          "name": "sampleFrame",
          "module": "mathUtils",
          "line": 169,
          "exported": true,
          "parent": null,
          "calls": [
            "mathUtils:clamp01",
            "mathUtils:lerp"
          ],
          "externalCalls": [
            "twist"
          ],
          "paramRefs": []
        },
        {
          "id": "mathUtils:growFrames",
          "name": "growFrames",
          "module": "mathUtils",
          "line": 236,
          "exported": true,
          "parent": null,
          "calls": [
            "mathUtils:anyPerp",
            "mathUtils:smoothstep",
            "mathUtils:organicNoise1",
            "mathUtils:rotateTowardUp"
          ],
          "externalCalls": [
            "twist"
          ],
          "paramRefs": [
            "branches:segments",
            "roots:length",
            "branches:curve",
            "branches:curveVariance",
            "branches:gravity",
            "trunk:gnarl",
            "branches:twist",
            "branches:twistProfile",
            "branches:radiusCurve",
            "branches:nodeRoll",
            "branches:nodeOffset",
            "branches:nodeJumble",
            "branches:nodeRollBias",
            "branches:nodeJumbleBias",
            "branches:spineNoise"
          ]
        },
        {
          "id": "mathUtils:constructor",
          "name": "constructor",
          "module": "mathUtils",
          "line": 400,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "mathUtils:vertexCount",
          "name": "vertexCount",
          "module": "mathUtils",
          "line": 414,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "mathUtils:triangleCount",
          "name": "triangleCount",
          "module": "mathUtils",
          "line": 419,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "mathUtils:vertex",
          "name": "vertex",
          "module": "mathUtils",
          "line": 440,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "mathUtils:tri",
          "name": "tri",
          "module": "mathUtils",
          "line": 458,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "mathUtils:build",
          "name": "build",
          "module": "mathUtils",
          "line": 471,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [
            "twist"
          ],
          "paramRefs": []
        },
        {
          "id": "mathUtils:boxInfo",
          "name": "boxInfo",
          "module": "mathUtils",
          "line": 496,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [
            "twist"
          ],
          "paramRefs": []
        }
      ]
    },
    {
      "id": "meshTopology",
      "name": "meshTopology",
      "title": "网格拓扑",
      "category": "几何生成",
      "file": "src/core/meshTopology.js",
      "functions": [
        {
          "id": "meshTopology:edgeKey",
          "name": "edgeKey",
          "module": "meshTopology",
          "line": 44,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "meshTopology:analyzeTopology",
          "name": "analyzeTopology",
          "module": "meshTopology",
          "line": 69,
          "exported": true,
          "parent": null,
          "calls": [
            "meshTopology:resolve",
            "meshTopology:edgeKey",
            "meshTopology:find2",
            "meshTopology:addLink"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "meshTopology:resolve",
          "name": "resolve",
          "module": "meshTopology",
          "line": 113,
          "exported": false,
          "parent": "meshTopology:analyzeTopology",
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "meshTopology:find2",
          "name": "find2",
          "module": "meshTopology",
          "line": 165,
          "exported": false,
          "parent": "meshTopology:analyzeTopology",
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "meshTopology:addLink",
          "name": "addLink",
          "module": "meshTopology",
          "line": 213,
          "exported": false,
          "parent": "meshTopology:analyzeTopology",
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "meshTopology:branchSkinCoverage",
          "name": "branchSkinCoverage",
          "module": "meshTopology",
          "line": 303,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "meshTopology:validateSkin",
          "name": "validateSkin",
          "module": "meshTopology",
          "line": 333,
          "exported": true,
          "parent": null,
          "calls": [
            "meshTopology:analyzeTopology",
            "meshTopology:branchSkinCoverage"
          ],
          "externalCalls": [],
          "paramRefs": []
        }
      ]
    },
    {
      "id": "modelStats",
      "name": "modelStats",
      "title": "模型统计",
      "category": "导出与统计",
      "file": "src/core/modelStats.js",
      "functions": [
        {
          "id": "modelStats:modelTriangleCount",
          "name": "modelTriangleCount",
          "module": "modelStats",
          "line": 27,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "modelStats:modelVertexCount",
          "name": "modelVertexCount",
          "module": "modelStats",
          "line": 45,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        }
      ]
    },
    {
      "id": "normalFromAlbedo",
      "name": "normalFromAlbedo",
      "title": "法线生成",
      "category": "材质与贴图",
      "file": "src/core/normalFromAlbedo.js",
      "functions": [
        {
          "id": "normalFromAlbedo:normalFromLuminance",
          "name": "normalFromLuminance",
          "module": "normalFromAlbedo",
          "line": 64,
          "exported": true,
          "parent": null,
          "calls": [
            "normalFromAlbedo:at"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "normalFromAlbedo:at",
          "name": "at",
          "module": "normalFromAlbedo",
          "line": 90,
          "exported": false,
          "parent": "normalFromAlbedo:normalFromLuminance",
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "normalFromAlbedo:albedoNormalTexture",
          "name": "albedoNormalTexture",
          "module": "normalFromAlbedo",
          "line": 167,
          "exported": true,
          "parent": null,
          "calls": [
            "normalFromAlbedo:normalFromLuminance"
          ],
          "externalCalls": [],
          "paramRefs": []
        }
      ]
    },
    {
      "id": "paramDocs",
      "name": "paramDocs",
      "title": "参数说明",
      "category": "参数与预设",
      "file": "src/core/paramDocs.js",
      "functions": [
        {
          "id": "paramDocs:normalize",
          "name": "normalize",
          "module": "paramDocs",
          "line": 603,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "paramDocs:docFor",
          "name": "docFor",
          "module": "paramDocs",
          "line": 628,
          "exported": true,
          "parent": null,
          "calls": [
            "paramDocs:normalize"
          ],
          "externalCalls": [],
          "paramRefs": []
        }
      ]
    },
    {
      "id": "params",
      "name": "params",
      "title": "参数定义",
      "category": "参数与预设",
      "file": "src/core/params.js",
      "functions": [
        {
          "id": "params:defaultLevel",
          "name": "defaultLevel",
          "module": "params",
          "line": 76,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "params:ensureFeatureDefaults",
          "name": "ensureFeatureDefaults",
          "module": "params",
          "line": 160,
          "exported": true,
          "parent": null,
          "calls": [
            "params:defaultParams",
            "params:fill"
          ],
          "externalCalls": [],
          "paramRefs": [
            "fall:*",
            "litter:*",
            "flowerFall:*",
            "flowerLitter:*",
            "leaves:*",
            "flower:*"
          ]
        },
        {
          "id": "params:fill",
          "name": "fill",
          "module": "params",
          "line": 163,
          "exported": false,
          "parent": "params:ensureFeatureDefaults",
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "params:defaultParams",
          "name": "defaultParams",
          "module": "params",
          "line": 201,
          "exported": true,
          "parent": null,
          "calls": [
            "params:defaultLevel"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "params:cloneParams",
          "name": "cloneParams",
          "module": "params",
          "line": 741,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "params:mergeParams",
          "name": "mergeParams",
          "module": "params",
          "line": 763,
          "exported": true,
          "parent": null,
          "calls": [
            "params:cloneParams",
            "params:walk"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "params:walk",
          "name": "walk",
          "module": "params",
          "line": 765,
          "exported": false,
          "parent": "params:mergeParams",
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "params:normalizeParams",
          "name": "normalizeParams",
          "module": "params",
          "line": 803,
          "exported": true,
          "parent": null,
          "calls": [
            "params:mergeParams",
            "forceField:normalizeForces",
            "params:defaultLevel"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "params:pickStringify",
          "name": "pickStringify",
          "module": "params",
          "line": 846,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "params:serializeGroup",
          "name": "serializeGroup",
          "module": "params",
          "line": 860,
          "exported": true,
          "parent": null,
          "calls": [
            "params:pickStringify"
          ],
          "externalCalls": [],
          "paramRefs": []
        }
      ]
    },
    {
      "id": "particles",
      "name": "particles",
      "title": "粒子",
      "category": "场景与风",
      "file": "src/core/particles.js",
      "functions": [
        {
          "id": "particles:sampleEmitPositions",
          "name": "sampleEmitPositions",
          "module": "particles",
          "line": 29,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": [
            "particles:*",
            "branches:count",
            "branches:spread"
          ]
        },
        {
          "id": "particles:buildParticleSeeds",
          "name": "buildParticleSeeds",
          "module": "particles",
          "line": 62,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "particles:createParticleMaterial",
          "name": "createParticleMaterial",
          "module": "particles",
          "line": 168,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [
            "rng"
          ],
          "paramRefs": [
            "particles:*",
            "leaves:size",
            "fall:*",
            "particles:sway",
            "particles:glow",
            "leaves:color"
          ]
        },
        {
          "id": "particles:updateParticleMaterial",
          "name": "updateParticleMaterial",
          "module": "particles",
          "line": 217,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": [
            "particles:*",
            "leaves:size",
            "fall:*",
            "particles:sway",
            "particles:glow",
            "leaves:color"
          ]
        },
        {
          "id": "particles:buildParticlePoints",
          "name": "buildParticlePoints",
          "module": "particles",
          "line": 236,
          "exported": true,
          "parent": null,
          "calls": [
            "particles:sampleEmitPositions",
            "particles:buildParticleSeeds",
            "particles:createParticleMaterial",
            "particles:updateParticleMaterial"
          ],
          "externalCalls": [
            "rng"
          ],
          "paramRefs": [
            "particles:*",
            "branches:enabled"
          ]
        }
      ]
    },
    {
      "id": "presets",
      "name": "presets",
      "title": "预设",
      "category": "参数与预设",
      "file": "src/core/presets.js",
      "functions": [
        {
          "id": "presets:randomSeed",
          "name": "randomSeed",
          "module": "presets",
          "line": 53,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "presets:presetById",
          "name": "presetById",
          "module": "presets",
          "line": 86,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "presets:preserveUserBits",
          "name": "preserveUserBits",
          "module": "presets",
          "line": 120,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "presets:applyPreset",
          "name": "applyPreset",
          "module": "presets",
          "line": 174,
          "exported": true,
          "parent": null,
          "calls": [
            "presets:preserveUserBits"
          ],
          "externalCalls": [
            "species"
          ],
          "paramRefs": [
            "seed:*",
            "wind:*"
          ]
        },
        {
          "id": "presets:weightedPick",
          "name": "weightedPick",
          "module": "presets",
          "line": 230,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "presets:autoGenerate",
          "name": "autoGenerate",
          "module": "presets",
          "line": 262,
          "exported": true,
          "parent": null,
          "calls": [
            "presets:weightedPick"
          ],
          "externalCalls": [
            "rng",
            "species",
            "treeBuilder"
          ],
          "paramRefs": [
            "trunk:*",
            "branches:*",
            "leaves:*",
            "wind:*",
            "auto:*",
            "classify:*",
            "seed:*",
            "branches:count",
            "branches:pitch",
            "branches:pitchVariance",
            "branches:lengthRatio",
            "branches:lengthVariance",
            "branches:radiusRatio",
            "branches:curve",
            "branches:gravity",
            "branches:twist",
            "branches:phyllotaxis",
            "branches:spread"
          ]
        },
        {
          "id": "presets:archetypeName",
          "name": "archetypeName",
          "module": "presets",
          "line": 364,
          "exported": true,
          "parent": null,
          "calls": [
            "presets:presetById"
          ],
          "externalCalls": [],
          "paramRefs": []
        }
      ]
    },
    {
      "id": "propertySearch",
      "name": "propertySearch",
      "title": "属性搜索",
      "category": "应用与接口",
      "file": "src/core/propertySearch.js",
      "functions": [
        {
          "id": "propertySearch:searchLabels",
          "name": "searchLabels",
          "module": "propertySearch",
          "line": 39,
          "exported": true,
          "parent": null,
          "calls": [
            "paramDocs:docFor"
          ],
          "externalCalls": [],
          "paramRefs": []
        }
      ]
    },
    {
      "id": "renderChunks",
      "name": "renderChunks",
      "title": "渲染分块",
      "category": "场景与风",
      "file": "src/core/renderChunks.js",
      "functions": [
        {
          "id": "renderChunks:buildFrustumChunks",
          "name": "buildFrustumChunks",
          "module": "renderChunks",
          "line": 55,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "renderChunks:hideSourceMesh",
          "name": "hideSourceMesh",
          "module": "renderChunks",
          "line": 155,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        }
      ]
    },
    {
      "id": "rng",
      "name": "rng",
      "title": "随机流",
      "category": "几何生成",
      "file": "src/core/rng.js",
      "functions": [
        {
          "id": "rng:hashString",
          "name": "hashString",
          "module": "rng",
          "line": 27,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "rng:mulberry32",
          "name": "mulberry32",
          "module": "rng",
          "line": 51,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "rng:mixSeed",
          "name": "mixSeed",
          "module": "rng",
          "line": 71,
          "exported": true,
          "parent": null,
          "calls": [
            "rng:hashString"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "rng:constructor",
          "name": "constructor",
          "module": "rng",
          "line": 90,
          "exported": false,
          "parent": null,
          "calls": [
            "rng:mixSeed",
            "rng:mulberry32"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "rng:next",
          "name": "next",
          "module": "rng",
          "line": 98,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "rng:range",
          "name": "range",
          "module": "rng",
          "line": 103,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "rng:int",
          "name": "int",
          "module": "rng",
          "line": 108,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "rng:chance",
          "name": "chance",
          "module": "rng",
          "line": 113,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "rng:signed",
          "name": "signed",
          "module": "rng",
          "line": 118,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "rng:vary",
          "name": "vary",
          "module": "rng",
          "line": 123,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "rng:pick",
          "name": "pick",
          "module": "rng",
          "line": 128,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "rng:gauss",
          "name": "gauss",
          "module": "rng",
          "line": 138,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "rng:fork",
          "name": "fork",
          "module": "rng",
          "line": 145,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "rng:makeRng",
          "name": "makeRng",
          "module": "rng",
          "line": 157,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        }
      ]
    },
    {
      "id": "sceneManager",
      "name": "sceneManager",
      "title": "场景管理",
      "category": "场景与风",
      "file": "src/core/sceneManager.js",
      "functions": [
        {
          "id": "sceneManager:bindTransformDrag",
          "name": "bindTransformDrag",
          "module": "sceneManager",
          "line": 115,
          "exported": false,
          "parent": null,
          "calls": [
            "sceneManager:start",
            "sceneManager:end"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:start",
          "name": "start",
          "module": "sceneManager",
          "line": 117,
          "exported": false,
          "parent": "sceneManager:bindTransformDrag",
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:end",
          "name": "end",
          "module": "sceneManager",
          "line": 122,
          "exported": false,
          "parent": "sceneManager:bindTransformDrag",
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:constructor",
          "name": "constructor",
          "module": "sceneManager",
          "line": 157,
          "exported": false,
          "parent": null,
          "calls": [
            "sceneManager:bindTransformDrag",
            "materials:createSharedUniforms"
          ],
          "externalCalls": [
            "treeBuilder"
          ],
          "paramRefs": []
        },
        {
          "id": "sceneManager:_createStars",
          "name": "_createStars",
          "module": "sceneManager",
          "line": 520,
          "exported": false,
          "parent": null,
          "calls": [
            "rng:makeRng"
          ],
          "externalCalls": [
            "treeBuilder"
          ],
          "paramRefs": []
        },
        {
          "id": "sceneManager:resize",
          "name": "resize",
          "module": "sceneManager",
          "line": 575,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:ensureMaterials",
          "name": "ensureMaterials",
          "module": "sceneManager",
          "line": 599,
          "exported": false,
          "parent": null,
          "calls": [
            "materials:createBarkMaterial",
            "materials:createLeafMaterial",
            "materials:createFlowerMaterial"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:updateMaterialParams",
          "name": "updateMaterialParams",
          "module": "sceneManager",
          "line": 622,
          "exported": false,
          "parent": null,
          "calls": [
            "materials:updateMaterials"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:rebindCustomShader",
          "name": "rebindCustomShader",
          "module": "sceneManager",
          "line": 647,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:updateWind",
          "name": "updateWind",
          "module": "sceneManager",
          "line": 681,
          "exported": false,
          "parent": null,
          "calls": [
            "materials:updateWindUniforms"
          ],
          "externalCalls": [],
          "paramRefs": [
            "wind:*"
          ]
        },
        {
          "id": "sceneManager:build",
          "name": "build",
          "module": "sceneManager",
          "line": 714,
          "exported": false,
          "parent": null,
          "calls": [
            "materials:updateMaterials",
            "mathUtils:boxInfo"
          ],
          "externalCalls": [
            "treeBuilder"
          ],
          "paramRefs": [
            "forces:*",
            "scene:*"
          ]
        },
        {
          "id": "sceneManager:setSkeletonVisible",
          "name": "setSkeletonVisible",
          "module": "sceneManager",
          "line": 846,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:_syncSkeletonVisibility",
          "name": "_syncSkeletonVisibility",
          "module": "sceneManager",
          "line": 855,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:setSkeletonOnly",
          "name": "setSkeletonOnly",
          "module": "sceneManager",
          "line": 867,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:_updateSkeletonOverlay",
          "name": "_updateSkeletonOverlay",
          "module": "sceneManager",
          "line": 894,
          "exported": false,
          "parent": null,
          "calls": [
            "sceneManager:colorOf"
          ],
          "externalCalls": [
            "treeBuilder"
          ],
          "paramRefs": []
        },
        {
          "id": "sceneManager:colorOf",
          "name": "colorOf",
          "module": "sceneManager",
          "line": 907,
          "exported": false,
          "parent": "sceneManager:_updateSkeletonOverlay",
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:setBranchTransformGizmo",
          "name": "setBranchTransformGizmo",
          "module": "sceneManager",
          "line": 992,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:_hideBranchGizmo",
          "name": "_hideBranchGizmo",
          "module": "sceneManager",
          "line": 1014,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:setForceTransformGizmo",
          "name": "setForceTransformGizmo",
          "module": "sceneManager",
          "line": 1030,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:setForcePicking",
          "name": "setForcePicking",
          "module": "sceneManager",
          "line": 1050,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:_hideForceGizmo",
          "name": "_hideForceGizmo",
          "module": "sceneManager",
          "line": 1055,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:_syncForceGizmo",
          "name": "_syncForceGizmo",
          "module": "sceneManager",
          "line": 1062,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:_findForceItem",
          "name": "_findForceItem",
          "module": "sceneManager",
          "line": 1083,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:_commitForceGizmo",
          "name": "_commitForceGizmo",
          "module": "sceneManager",
          "line": 1094,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [
            "treeBuilder"
          ],
          "paramRefs": []
        },
        {
          "id": "sceneManager:_compensateForceFieldDuringDrag",
          "name": "_compensateForceFieldDuringDrag",
          "module": "sceneManager",
          "line": 1139,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:_pickForceAt",
          "name": "_pickForceAt",
          "module": "sceneManager",
          "line": 1160,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [
            "treeBuilder"
          ],
          "paramRefs": []
        },
        {
          "id": "sceneManager:_syncBranchGizmo",
          "name": "_syncBranchGizmo",
          "module": "sceneManager",
          "line": 1196,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [
            "treeBuilder"
          ],
          "paramRefs": [
            "branchEdits:*"
          ]
        },
        {
          "id": "sceneManager:_commitBranchGizmo",
          "name": "_commitBranchGizmo",
          "module": "sceneManager",
          "line": 1264,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [
            "treeBuilder"
          ],
          "paramRefs": []
        },
        {
          "id": "sceneManager:_buildCullChunks",
          "name": "_buildCullChunks",
          "module": "sceneManager",
          "line": 1317,
          "exported": false,
          "parent": null,
          "calls": [
            "sceneManager:add"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:add",
          "name": "add",
          "module": "sceneManager",
          "line": 1320,
          "exported": false,
          "parent": "sceneManager:_buildCullChunks",
          "calls": [
            "renderChunks:buildFrustumChunks",
            "renderChunks:hideSourceMesh"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:_disposeCullChunks",
          "name": "_disposeCullChunks",
          "module": "sceneManager",
          "line": 1349,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:_syncCullChunks",
          "name": "_syncCullChunks",
          "module": "sceneManager",
          "line": 1367,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:_meshTriangles",
          "name": "_meshTriangles",
          "module": "sceneManager",
          "line": 1391,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:_disposeLods",
          "name": "_disposeLods",
          "module": "sceneManager",
          "line": 1405,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:_ensureLod",
          "name": "_ensureLod",
          "module": "sceneManager",
          "line": 1441,
          "exported": false,
          "parent": null,
          "calls": [
            "params:cloneParams"
          ],
          "externalCalls": [
            "treeBuilder"
          ],
          "paramRefs": [
            "lod:*",
            "lod:keep1",
            "lod:keep2"
          ]
        },
        {
          "id": "sceneManager:_buildLodInfo",
          "name": "_buildLodInfo",
          "module": "sceneManager",
          "line": 1504,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:applyLod",
          "name": "applyLod",
          "module": "sceneManager",
          "line": 1528,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:updateLod",
          "name": "updateLod",
          "module": "sceneManager",
          "line": 1574,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": [
            "lod:*",
            "lod:force",
            "lod:dynamic",
            "lod:distance1",
            "lod:distance2"
          ]
        },
        {
          "id": "sceneManager:projectTwistGuide",
          "name": "projectTwistGuide",
          "module": "sceneManager",
          "line": 1629,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [
            "treeBuilder"
          ],
          "paramRefs": []
        },
        {
          "id": "sceneManager:setSelection",
          "name": "setSelection",
          "module": "sceneManager",
          "line": 1693,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:applyShadowFlags",
          "name": "applyShadowFlags",
          "module": "sceneManager",
          "line": 1743,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:_depthMaterialFor",
          "name": "_depthMaterialFor",
          "module": "sceneManager",
          "line": 1774,
          "exported": false,
          "parent": null,
          "calls": [
            "materials:createTreeDepthMaterial"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:setSelectionBox",
          "name": "setSelectionBox",
          "module": "sceneManager",
          "line": 1793,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [
            "treeBuilder"
          ],
          "paramRefs": []
        },
        {
          "id": "sceneManager:focusBox",
          "name": "focusBox",
          "module": "sceneManager",
          "line": 1826,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [
            "treeBuilder"
          ],
          "paramRefs": []
        },
        {
          "id": "sceneManager:frameCamera",
          "name": "frameCamera",
          "module": "sceneManager",
          "line": 1858,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:updateScene",
          "name": "updateScene",
          "module": "sceneManager",
          "line": 1905,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [
            "treeBuilder"
          ],
          "paramRefs": []
        },
        {
          "id": "sceneManager:updateForceGizmos",
          "name": "updateForceGizmos",
          "module": "sceneManager",
          "line": 2007,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [
            "treeBuilder"
          ],
          "paramRefs": []
        },
        {
          "id": "sceneManager:updateGrowth",
          "name": "updateGrowth",
          "module": "sceneManager",
          "line": 2118,
          "exported": false,
          "parent": null,
          "calls": [
            "materials:updateGrowthUniforms"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:setGrowthAuto",
          "name": "setGrowthAuto",
          "module": "sceneManager",
          "line": 2130,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:setPlaying",
          "name": "setPlaying",
          "module": "sceneManager",
          "line": 2141,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:getWindScreenBasis",
          "name": "getWindScreenBasis",
          "module": "sceneManager",
          "line": 2157,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [
            "treeBuilder"
          ],
          "paramRefs": []
        },
        {
          "id": "sceneManager:applyWireframe",
          "name": "applyWireframe",
          "module": "sceneManager",
          "line": 2186,
          "exported": false,
          "parent": null,
          "calls": [
            "sceneManager:mk"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:mk",
          "name": "mk",
          "module": "sceneManager",
          "line": 2215,
          "exported": false,
          "parent": "sceneManager:applyWireframe",
          "calls": [],
          "externalCalls": [
            "treeBuilder"
          ],
          "paramRefs": []
        },
        {
          "id": "sceneManager:rebuildParticles",
          "name": "rebuildParticles",
          "module": "sceneManager",
          "line": 2257,
          "exported": false,
          "parent": null,
          "calls": [
            "particles:buildParticlePoints"
          ],
          "externalCalls": [],
          "paramRefs": [
            "particles:*",
            "branches:enabled",
            "seed:*"
          ]
        },
        {
          "id": "sceneManager:updateParticles",
          "name": "updateParticles",
          "module": "sceneManager",
          "line": 2284,
          "exported": false,
          "parent": null,
          "calls": [
            "particles:updateParticleMaterial"
          ],
          "externalCalls": [],
          "paramRefs": [
            "particles:*",
            "branches:enabled",
            "branches:count"
          ]
        },
        {
          "id": "sceneManager:rebuildFall",
          "name": "rebuildFall",
          "module": "sceneManager",
          "line": 2322,
          "exported": false,
          "parent": null,
          "calls": [
            "fallingLeaves:buildFallingLeaves"
          ],
          "externalCalls": [],
          "paramRefs": [
            "fall:*",
            "leafMat:*"
          ]
        },
        {
          "id": "sceneManager:updateFall",
          "name": "updateFall",
          "module": "sceneManager",
          "line": 2355,
          "exported": false,
          "parent": null,
          "calls": [
            "fallingLeaves:fallRebuildKey",
            "fallingLeaves:updateFallingLeaves"
          ],
          "externalCalls": [],
          "paramRefs": [
            "fall:*"
          ]
        },
        {
          "id": "sceneManager:_flowerFallParams",
          "name": "_flowerFallParams",
          "module": "sceneManager",
          "line": 2376,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": [
            "flowerFall:*",
            "flower:*",
            "fall:*",
            "leafMat:*"
          ]
        },
        {
          "id": "sceneManager:_flowerLitterParams",
          "name": "_flowerLitterParams",
          "module": "sceneManager",
          "line": 2400,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": [
            "flowerLitter:*",
            "flower:*",
            "litter:*",
            "leafMat:*"
          ]
        },
        {
          "id": "sceneManager:_flowerCanopyGeometry",
          "name": "_flowerCanopyGeometry",
          "module": "sceneManager",
          "line": 2418,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:rebuildFlowerFall",
          "name": "rebuildFlowerFall",
          "module": "sceneManager",
          "line": 2429,
          "exported": false,
          "parent": null,
          "calls": [
            "fallingLeaves:buildFallingLeaves"
          ],
          "externalCalls": [],
          "paramRefs": [
            "flowerFall:*"
          ]
        },
        {
          "id": "sceneManager:updateFlowerFall",
          "name": "updateFlowerFall",
          "module": "sceneManager",
          "line": 2453,
          "exported": false,
          "parent": null,
          "calls": [
            "fallingLeaves:fallRebuildKey",
            "fallingLeaves:updateFallingLeaves"
          ],
          "externalCalls": [],
          "paramRefs": [
            "flowerFall:*"
          ]
        },
        {
          "id": "sceneManager:rebuildFlowerLitter",
          "name": "rebuildFlowerLitter",
          "module": "sceneManager",
          "line": 2479,
          "exported": false,
          "parent": null,
          "calls": [
            "litter:buildLeafLitter"
          ],
          "externalCalls": [],
          "paramRefs": [
            "flowerLitter:*"
          ]
        },
        {
          "id": "sceneManager:updateFlowerLitter",
          "name": "updateFlowerLitter",
          "module": "sceneManager",
          "line": 2504,
          "exported": false,
          "parent": null,
          "calls": [
            "litter:litterRebuildKey",
            "litter:updateLitterEffects"
          ],
          "externalCalls": [],
          "paramRefs": [
            "flowerLitter:*"
          ]
        },
        {
          "id": "sceneManager:rebuildLitter",
          "name": "rebuildLitter",
          "module": "sceneManager",
          "line": 2538,
          "exported": false,
          "parent": null,
          "calls": [
            "litter:buildLeafLitter"
          ],
          "externalCalls": [],
          "paramRefs": [
            "litter:*",
            "leafMat:*"
          ]
        },
        {
          "id": "sceneManager:updateLitter",
          "name": "updateLitter",
          "module": "sceneManager",
          "line": 2563,
          "exported": false,
          "parent": null,
          "calls": [
            "litter:litterRebuildKey",
            "litter:updateLitterEffects"
          ],
          "externalCalls": [],
          "paramRefs": [
            "litter:*"
          ]
        },
        {
          "id": "sceneManager:makeImpostor",
          "name": "makeImpostor",
          "module": "sceneManager",
          "line": 2605,
          "exported": false,
          "parent": null,
          "calls": [
            "impostor:generateImpostor"
          ],
          "externalCalls": [
            "treeBuilder"
          ],
          "paramRefs": []
        },
        {
          "id": "sceneManager:setImpostorPreview",
          "name": "setImpostorPreview",
          "module": "sceneManager",
          "line": 2657,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [
            "treeBuilder"
          ],
          "paramRefs": []
        },
        {
          "id": "sceneManager:_rehideForImpostorPreview",
          "name": "_rehideForImpostorPreview",
          "module": "sceneManager",
          "line": 2753,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:updateImpostorPreview",
          "name": "updateImpostorPreview",
          "module": "sceneManager",
          "line": 2784,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [
            "treeBuilder"
          ],
          "paramRefs": []
        },
        {
          "id": "sceneManager:clearImpostorPreview",
          "name": "clearImpostorPreview",
          "module": "sceneManager",
          "line": 2822,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:_getFruitExportMaterial",
          "name": "_getFruitExportMaterial",
          "module": "sceneManager",
          "line": 2860,
          "exported": false,
          "parent": null,
          "calls": [
            "fruitMaterial:disposeFruitExportMaterial",
            "fruitMaterial:createFruitExportMaterial"
          ],
          "externalCalls": [],
          "paramRefs": [
            "fruit:*",
            "seed:*"
          ]
        },
        {
          "id": "sceneManager:buildExportGroup",
          "name": "buildExportGroup",
          "module": "sceneManager",
          "line": 2888,
          "exported": false,
          "parent": null,
          "calls": [
            "exportSplit:barkExportParts",
            "sceneManager:add"
          ],
          "externalCalls": [
            "treeBuilder"
          ],
          "paramRefs": [
            "exportOptions:*",
            "trunk:*",
            "exportOptions:mergeBark"
          ]
        },
        {
          "id": "sceneManager:add#2",
          "name": "add",
          "module": "sceneManager",
          "line": 2891,
          "exported": false,
          "parent": "sceneManager:buildExportGroup",
          "calls": [],
          "externalCalls": [
            "treeBuilder"
          ],
          "paramRefs": []
        },
        {
          "id": "sceneManager:exportGLB",
          "name": "exportGLB",
          "module": "sceneManager",
          "line": 2923,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:exportOBJ",
          "name": "exportOBJ",
          "module": "sceneManager",
          "line": 2932,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:prepareExport",
          "name": "prepareExport",
          "module": "sceneManager",
          "line": 2949,
          "exported": false,
          "parent": null,
          "calls": [
            "exportPreview:buildGLBPreview",
            "exportPreview:buildOBJPreview",
            "exportPreview:buildPNGPreview"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:screenshot",
          "name": "screenshot",
          "module": "sceneManager",
          "line": 2968,
          "exported": false,
          "parent": null,
          "calls": [
            "exporter:exportScreenshot"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:tick",
          "name": "tick",
          "module": "sceneManager",
          "line": 2996,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "sceneManager:dispose",
          "name": "dispose",
          "module": "sceneManager",
          "line": 3049,
          "exported": false,
          "parent": null,
          "calls": [
            "fruitMaterial:disposeFruitExportMaterial"
          ],
          "externalCalls": [],
          "paramRefs": []
        }
      ]
    },
    {
      "id": "species",
      "name": "species",
      "title": "树种",
      "category": "参数与预设",
      "file": "src/core/species.js",
      "functions": [
        {
          "id": "species:levels",
          "name": "levels",
          "module": "species",
          "line": 57,
          "exported": false,
          "parent": null,
          "calls": [
            "params:defaultLevel"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "species:speciesById",
          "name": "speciesById",
          "module": "species",
          "line": 549,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "species:stageById",
          "name": "stageById",
          "module": "species",
          "line": 558,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "species:seasonById",
          "name": "seasonById",
          "module": "species",
          "line": 567,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "species:seasonProfile",
          "name": "seasonProfile",
          "module": "species",
          "line": 588,
          "exported": true,
          "parent": null,
          "calls": [
            "species:seasonById"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "species:applyVariation",
          "name": "applyVariation",
          "module": "species",
          "line": 629,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": [
            "trunk:*",
            "branches:*",
            "leaves:*",
            "branches:count",
            "branches:pitch",
            "branches:pitchVariance",
            "branches:lengthRatio",
            "branches:lengthVariance",
            "branches:radiusRatio",
            "branches:curve",
            "branches:gravity",
            "branches:upBias",
            "branches:segments"
          ]
        },
        {
          "id": "species:applyStage",
          "name": "applyStage",
          "module": "species",
          "line": 706,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": [
            "trunk:*",
            "roots:*",
            "branches:*",
            "leaves:*"
          ]
        },
        {
          "id": "species:applySeason",
          "name": "applySeason",
          "module": "species",
          "line": 781,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": [
            "leaves:*",
            "bark:*",
            "leafMat:*"
          ]
        },
        {
          "id": "species:composeTree",
          "name": "composeTree",
          "module": "species",
          "line": 842,
          "exported": true,
          "parent": null,
          "calls": [
            "species:speciesById",
            "species:stageById",
            "rng:makeRng",
            "params:mergeParams",
            "species:applyVariation",
            "species:applyStage",
            "species:applySeason",
            "species:seasonProfile"
          ],
          "externalCalls": [
            "treeBuilder"
          ],
          "paramRefs": [
            "leaves:*",
            "classify:*",
            "seed:*",
            "auto:*",
            "wind:*",
            "branches:*",
            "auto:chaos"
          ]
        },
        {
          "id": "species:classificationName",
          "name": "classificationName",
          "module": "species",
          "line": 929,
          "exported": true,
          "parent": null,
          "calls": [
            "species:speciesById",
            "species:stageById",
            "species:seasonById",
            "species:seasonProfile"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "species:classificationDesc",
          "name": "classificationDesc",
          "module": "species",
          "line": 949,
          "exported": true,
          "parent": null,
          "calls": [
            "species:speciesById",
            "species:stageById",
            "species:seasonProfile",
            "species:seasonById"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "species:allCombinations",
          "name": "allCombinations",
          "module": "species",
          "line": 969,
          "exported": true,
          "parent": null,
          "calls": [
            "species:classificationName"
          ],
          "externalCalls": [],
          "paramRefs": []
        }
      ]
    },
    {
      "id": "speedtreeBark",
      "name": "speedtreeBark",
      "title": "SpeedTree 蒙皮",
      "category": "几何生成",
      "file": "src/core/speedtreeBark.js",
      "functions": [
        {
          "id": "speedtreeBark:rgb",
          "name": "rgb",
          "module": "speedtreeBark",
          "line": 49,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "speedtreeBark:smooth01",
          "name": "smooth01",
          "module": "speedtreeBark",
          "line": 61,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "speedtreeBark:buildRingBases",
          "name": "buildRingBases",
          "module": "speedtreeBark",
          "line": 79,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [
            "mathUtils"
          ],
          "paramRefs": []
        },
        {
          "id": "speedtreeBark:tubeFrames",
          "name": "tubeFrames",
          "module": "speedtreeBark",
          "line": 132,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "speedtreeBark:ringModifier",
          "name": "ringModifier",
          "module": "speedtreeBark",
          "line": 181,
          "exported": false,
          "parent": null,
          "calls": [
            "speedtreeBark:smooth01"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "speedtreeBark:buildSpeedtreeBark",
          "name": "buildSpeedtreeBark",
          "module": "speedtreeBark",
          "line": 227,
          "exported": true,
          "parent": null,
          "calls": [
            "speedtreeBark:tubeFrames",
            "speedtreeBark:buildRingBases",
            "speedtreeBark:rgb",
            "speedtreeBark:ringModifier",
            "speedtreeBark:smooth01",
            "meshTopology:analyzeTopology",
            "meshTopology:branchSkinCoverage"
          ],
          "externalCalls": [],
          "paramRefs": [
            "lod:barkDetail"
          ]
        }
      ]
    },
    {
      "id": "templateDb",
      "name": "templateDb",
      "title": "模板库",
      "category": "参数与预设",
      "file": "src/core/templateDb.js",
      "functions": [
        {
          "id": "templateDb:templatesSupported",
          "name": "templatesSupported",
          "module": "templateDb",
          "line": 25,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "templateDb:openDb",
          "name": "openDb",
          "module": "templateDb",
          "line": 30,
          "exported": false,
          "parent": null,
          "calls": [
            "templateDb:templatesSupported"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "templateDb:withStore",
          "name": "withStore",
          "module": "templateDb",
          "line": 49,
          "exported": false,
          "parent": null,
          "calls": [
            "templateDb:openDb"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "templateDb:listTemplates",
          "name": "listTemplates",
          "module": "templateDb",
          "line": 76,
          "exported": true,
          "parent": null,
          "calls": [
            "templateDb:templatesSupported",
            "templateDb:openDb"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "templateDb:getTemplate",
          "name": "getTemplate",
          "module": "templateDb",
          "line": 108,
          "exported": true,
          "parent": null,
          "calls": [
            "templateDb:templatesSupported",
            "templateDb:openDb"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "templateDb:putTemplate",
          "name": "putTemplate",
          "module": "templateDb",
          "line": 130,
          "exported": true,
          "parent": null,
          "calls": [
            "templateDb:templatesSupported",
            "templateDb:withStore"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "templateDb:deleteTemplate",
          "name": "deleteTemplate",
          "module": "templateDb",
          "line": 147,
          "exported": true,
          "parent": null,
          "calls": [
            "templateDb:templatesSupported",
            "templateDb:withStore"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "templateDb:clearTemplates",
          "name": "clearTemplates",
          "module": "templateDb",
          "line": 155,
          "exported": true,
          "parent": null,
          "calls": [
            "templateDb:templatesSupported",
            "templateDb:withStore"
          ],
          "externalCalls": [],
          "paramRefs": []
        }
      ]
    },
    {
      "id": "textureNaming",
      "name": "textureNaming",
      "title": "textureNaming",
      "category": "其他",
      "file": "src/core/textureNaming.js",
      "functions": [
        {
          "id": "textureNaming:imageSize",
          "name": "imageSize",
          "module": "textureNaming",
          "line": 87,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "textureNaming:textureResolutionK",
          "name": "textureResolutionK",
          "module": "textureNaming",
          "line": 101,
          "exported": true,
          "parent": null,
          "calls": [
            "textureNaming:imageSize"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "textureNaming:safeBase",
          "name": "safeBase",
          "module": "textureNaming",
          "line": 118,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "textureNaming:drawTextureToCanvas",
          "name": "drawTextureToCanvas",
          "module": "textureNaming",
          "line": 135,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "textureNaming:makeNormalTextureFromPixels",
          "name": "makeNormalTextureFromPixels",
          "module": "textureNaming",
          "line": 160,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [
            "normalFromAlbedo"
          ],
          "paramRefs": []
        },
        {
          "id": "textureNaming:makeNormalTextureFromTexture",
          "name": "makeNormalTextureFromTexture",
          "module": "textureNaming",
          "line": 201,
          "exported": true,
          "parent": null,
          "calls": [
            "textureNaming:drawTextureToCanvas",
            "textureNaming:makeNormalTextureFromPixels"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "textureNaming:makeRoughnessTextureFromTexture",
          "name": "makeRoughnessTextureFromTexture",
          "module": "textureNaming",
          "line": 235,
          "exported": true,
          "parent": null,
          "calls": [
            "textureNaming:drawTextureToCanvas",
            "textureNaming:lumAt"
          ],
          "externalCalls": [
            "normalFromAlbedo"
          ],
          "paramRefs": []
        },
        {
          "id": "textureNaming:lumAt",
          "name": "lumAt",
          "module": "textureNaming",
          "line": 247,
          "exported": false,
          "parent": "textureNaming:makeRoughnessTextureFromTexture",
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "textureNaming:makeAlphaDataUrl",
          "name": "makeAlphaDataUrl",
          "module": "textureNaming",
          "line": 297,
          "exported": true,
          "parent": null,
          "calls": [
            "textureNaming:drawTextureToCanvas"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "textureNaming:textureAssetName",
          "name": "textureAssetName",
          "module": "textureNaming",
          "line": 337,
          "exported": true,
          "parent": null,
          "calls": [
            "textureNaming:textureResolutionK"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "textureNaming:applyExportTextureNames",
          "name": "applyExportTextureNames",
          "module": "textureNaming",
          "line": 365,
          "exported": true,
          "parent": null,
          "calls": [
            "textureNaming:add",
            "textureNaming:textureAssetName",
            "textureNaming:imageSize",
            "textureNaming:makeAlphaDataUrl"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "textureNaming:add",
          "name": "add",
          "module": "textureNaming",
          "line": 384,
          "exported": false,
          "parent": "textureNaming:applyExportTextureNames",
          "calls": [
            "textureNaming:textureAssetName",
            "textureNaming:imageSize",
            "textureNaming:textureResolutionK"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "textureNaming:readGlb",
          "name": "readGlb",
          "module": "textureNaming",
          "line": 458,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "textureNaming:writeGlb",
          "name": "writeGlb",
          "module": "textureNaming",
          "line": 485,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "textureNaming:padJson",
          "name": "padJson",
          "module": "textureNaming",
          "line": 514,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "textureNaming:patchGlbTextureNames",
          "name": "patchGlbTextureNames",
          "module": "textureNaming",
          "line": 545,
          "exported": true,
          "parent": null,
          "calls": [
            "textureNaming:readGlb",
            "textureNaming:padJson",
            "textureNaming:writeGlb"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "textureNaming:makeCanvasTexture",
          "name": "makeCanvasTexture",
          "module": "textureNaming",
          "line": 618,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [
            "normalFromAlbedo"
          ],
          "paramRefs": []
        },
        {
          "id": "textureNaming:makeFlatNormalTexture",
          "name": "makeFlatNormalTexture",
          "module": "textureNaming",
          "line": 632,
          "exported": false,
          "parent": null,
          "calls": [
            "textureNaming:makeCanvasTexture"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "textureNaming:makeFlatRoughnessTexture",
          "name": "makeFlatRoughnessTexture",
          "module": "textureNaming",
          "line": 641,
          "exported": false,
          "parent": null,
          "calls": [
            "textureNaming:makeCanvasTexture"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "textureNaming:fallbackSize",
          "name": "fallbackSize",
          "module": "textureNaming",
          "line": 652,
          "exported": false,
          "parent": null,
          "calls": [
            "textureNaming:imageSize"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "textureNaming:ensureExportMaterialMaps",
          "name": "ensureExportMaterialMaps",
          "module": "textureNaming",
          "line": 680,
          "exported": true,
          "parent": null,
          "calls": [
            "textureNaming:fallbackSize",
            "textureNaming:makeNormalTextureFromTexture",
            "textureNaming:makeFlatNormalTexture",
            "textureNaming:makeRoughnessTextureFromTexture",
            "textureNaming:makeFlatRoughnessTexture"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "textureNaming:ensureExportRoughnessGrayscale",
          "name": "ensureExportRoughnessGrayscale",
          "module": "textureNaming",
          "line": 747,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "textureNaming:resampleExportMap",
          "name": "resampleExportMap",
          "module": "textureNaming",
          "line": 813,
          "exported": false,
          "parent": null,
          "calls": [
            "textureNaming:drawTextureToCanvas"
          ],
          "externalCalls": [
            "normalFromAlbedo"
          ],
          "paramRefs": []
        },
        {
          "id": "textureNaming:ensureExportTextureAlignment",
          "name": "ensureExportTextureAlignment",
          "module": "textureNaming",
          "line": 867,
          "exported": true,
          "parent": null,
          "calls": [
            "textureNaming:imageSize",
            "textureNaming:put",
            "textureNaming:makeNormalTextureFromTexture",
            "textureNaming:sameSize",
            "textureNaming:resampleExportMap",
            "textureNaming:makeRoughnessTextureFromTexture"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "textureNaming:sameSize",
          "name": "sameSize",
          "module": "textureNaming",
          "line": 888,
          "exported": false,
          "parent": "textureNaming:ensureExportTextureAlignment",
          "calls": [
            "textureNaming:imageSize"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "textureNaming:put",
          "name": "put",
          "module": "textureNaming",
          "line": 893,
          "exported": false,
          "parent": "textureNaming:ensureExportTextureAlignment",
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "textureNaming:sameUvTransform",
          "name": "sameUvTransform",
          "module": "textureNaming",
          "line": 964,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "textureNaming:ensureExportUvBake",
          "name": "ensureExportUvBake",
          "module": "textureNaming",
          "line": 997,
          "exported": true,
          "parent": null,
          "calls": [
            "textureNaming:sameUvTransform"
          ],
          "externalCalls": [],
          "paramRefs": []
        }
      ]
    },
    {
      "id": "textures",
      "name": "textures",
      "title": "贴图",
      "category": "材质与贴图",
      "file": "src/core/textures.js",
      "functions": [
        {
          "id": "textures:createCanvas",
          "name": "createCanvas",
          "module": "textures",
          "line": 32,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "textures:valueNoise2D",
          "name": "valueNoise2D",
          "module": "textures",
          "line": 52,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "textures:fbm",
          "name": "fbm",
          "module": "textures",
          "line": 92,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "textures:clamp01",
          "name": "clamp01",
          "module": "textures",
          "line": 107,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "textures:makeBarkTextures",
          "name": "makeBarkTextures",
          "module": "textures",
          "line": 129,
          "exported": true,
          "parent": null,
          "calls": [
            "textures:valueNoise2D",
            "textures:createCanvas",
            "textures:fbm",
            "textures:clamp01"
          ],
          "externalCalls": [
            "rng"
          ],
          "paramRefs": [
            "leaves:size",
            "bark:style",
            "bark:scale",
            "bark:contrast",
            "seed:*",
            "leaves:color",
            "bark:color2",
            "bark:bump"
          ]
        },
        {
          "id": "textures:makeLeafTexture",
          "name": "makeLeafTexture",
          "module": "textures",
          "line": 287,
          "exported": true,
          "parent": null,
          "calls": [
            "textures:valueNoise2D",
            "textures:createCanvas",
            "textures:clamp01",
            "textures:fbm"
          ],
          "externalCalls": [
            "rng"
          ],
          "paramRefs": [
            "leaves:size",
            "leaves:shape",
            "seed:*"
          ]
        },
        {
          "id": "textures:repairCardAlpha",
          "name": "repairCardAlpha",
          "module": "textures",
          "line": 363,
          "exported": false,
          "parent": null,
          "calls": [
            "textures:pushIfTransparent"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "textures:pushIfTransparent",
          "name": "pushIfTransparent",
          "module": "textures",
          "line": 407,
          "exported": false,
          "parent": "textures:repairCardAlpha",
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "textures:makeSeamlessCanvas",
          "name": "makeSeamlessCanvas",
          "module": "textures",
          "line": 501,
          "exported": false,
          "parent": null,
          "calls": [
            "textures:diffCol",
            "textures:diffRow",
            "textures:bandRatio"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "textures:diffCol",
          "name": "diffCol",
          "module": "textures",
          "line": 518,
          "exported": false,
          "parent": "textures:makeSeamlessCanvas",
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "textures:diffRow",
          "name": "diffRow",
          "module": "textures",
          "line": 527,
          "exported": false,
          "parent": "textures:makeSeamlessCanvas",
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "textures:bandRatio",
          "name": "bandRatio",
          "module": "textures",
          "line": 558,
          "exported": false,
          "parent": "textures:makeSeamlessCanvas",
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "textures:clearCardBorder",
          "name": "clearCardBorder",
          "module": "textures",
          "line": 649,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "textures:loadTexture",
          "name": "loadTexture",
          "module": "textures",
          "line": 686,
          "exported": true,
          "parent": null,
          "calls": [
            "textures:makeSeamlessCanvas",
            "textures:repairCardAlpha",
            "textures:clearCardBorder"
          ],
          "externalCalls": [
            "rng"
          ],
          "paramRefs": []
        },
        {
          "id": "textures:disposeTexture",
          "name": "disposeTexture",
          "module": "textures",
          "line": 726,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "textures:setTextureRepeat",
          "name": "setTextureRepeat",
          "module": "textures",
          "line": 741,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        }
      ]
    },
    {
      "id": "treeBuilder",
      "name": "treeBuilder",
      "title": "树构建器",
      "category": "参数与预设",
      "file": "src/core/treeBuilder.js",
      "functions": [
        {
          "id": "treeBuilder:now",
          "name": "now",
          "module": "treeBuilder",
          "line": 64,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeBuilder:childDirection",
          "name": "childDirection",
          "module": "treeBuilder",
          "line": 84,
          "exported": false,
          "parent": null,
          "calls": [
            "mathUtils:anyPerp",
            "mathUtils:rotateTowardUp"
          ],
          "externalCalls": [],
          "paramRefs": [
            "branches:*",
            "branches:phyllotaxis",
            "branches:spread",
            "branches:pitch",
            "branches:pitchVariance",
            "branches:gravity",
            "branches:upBias"
          ]
        },
        {
          "id": "treeBuilder:frameBasisAt",
          "name": "frameBasisAt",
          "module": "treeBuilder",
          "line": 117,
          "exported": false,
          "parent": null,
          "calls": [
            "mathUtils:clamp01",
            "mathUtils:anyPerp"
          ],
          "externalCalls": [
            "rng"
          ],
          "paramRefs": []
        },
        {
          "id": "treeBuilder:buildTree",
          "name": "buildTree",
          "module": "treeBuilder",
          "line": 168,
          "exported": true,
          "parent": null,
          "calls": [
            "treeBuilder:now",
            "forceField:createForceField",
            "barkSkeleton:createBarkSkeleton",
            "leaf:buildLeafTemplate",
            "leaf:buildLeafCardTemplate",
            "mathUtils:growFrames",
            "treeBuilder:sampleGuidePoints",
            "mathUtils:clamp01",
            "treeBuilder:applyBranchEdit",
            "treeBuilder:addSlot",
            "barkSkeleton:addBarkBranch",
            "mathUtils:sampleFrame",
            "treeBuilder:frameBasisAt",
            "treeBuilder:spawnChildren",
            "treeBuilder:projectTOnTrunk",
            "mathUtils:azimuthPerp",
            "mathUtils:rotateTowardUp",
            "treeBuilder:buildBranch",
            "barkSkeleton:finalizeBarkSkeleton",
            "barkSkeleton:enforceChildBranchRadii",
            "speedtreeBark:buildSpeedtreeBark",
            "barkSkin:buildBarkSkin",
            "treeBuilder:makeFlowerTemplate",
            "mathUtils:anyPerp",
            "leaf:pushLeafInstance",
            "ambientOcclusion:buildOcclusionGrid",
            "ambientOcclusion:bakeOcclusion",
            "ambientOcclusion:bakeOcclusionByRanges",
            "treeBuilder:finalizeNodes",
            "mathUtils:boxInfo"
          ],
          "externalCalls": [
            "mathUtils",
            "rng"
          ],
          "paramRefs": [
            "forces:*",
            "branches:*",
            "trunk:*",
            "leaves:*",
            "fruit:*",
            "flower:*",
            "lod:*",
            "seed:*",
            "branchEdits:*",
            "roots:*",
            "bark:*",
            "ao:*",
            "trunk:lean",
            "trunk:leanDirection",
            "trunk:knotStrength",
            "trunk:knotSpread",
            "trunk:knotAngle",
            "trunk:knotNoise",
            "trunk:knots",
            "trunk:knotSize",
            "trunk:baseRadius",
            "trunk:taper",
            "trunk:height",
            "trunk:radiusCurve",
            "trunk:segments",
            "trunk:curve",
            "trunk:curveVariance",
            "trunk:twist",
            "trunk:twistProfile",
            "trunk:gnarl",
            "trunk:spineNoise",
            "trunk:squash",
            "trunk:radialSegments",
            "trunk:crossNoise",
            "leaves:cardMode",
            "leaves:cardAspect",
            "leaves:cardCurl",
            "leaves:cardFold",
            "leaves:segments",
            "leaves:curl",
            "leaves:fold",
            "leaves:petiole",
            "leaves:shape",
            "leaves:color",
            "leaves:colorTip",
            "leaves:enabled",
            "flower:enabled",
            "flower:useShape",
            "flower:shape",
            "flower:segments",
            "flower:curl",
            "flower:fold",
            "flower:petiole",
            "flower:cardAspect",
            "flower:cardCurl",
            "flower:cardFold",
            "flower:size",
            "flower:width",
            "flower:sizeVariance",
            "flower:color",
            "flower:colorTip",
            "flower:levels",
            "flower:perBranch",
            "flower:clusterCount",
            "flower:startT",
            "flower:endT",
            "flower:density",
            "flower:clusterRadius",
            "flower:clusterSpread",
            "flower:pitch",
            "flower:pitchVariance",
            "flower:rollVariance",
            "flower:droop",
            "flower:branchWrap",
            "flower:branchWrapTurns",
            "flower:colorVariance",
            "flower:faceUp",
            "flower:twist",
            "flower:modelRotation",
            "roots:enabled",
            "roots:count",
            "roots:heightOffset",
            "roots:autoStagger",
            "roots:spread",
            "roots:pitch",
            "roots:length",
            "roots:lengthVariance",
            "roots:radiusRatio",
            "roots:segments",
            "roots:curve",
            "roots:sink",
            "roots:radialSegments"
          ]
        },
        {
          "id": "treeBuilder:effFruitLevels",
          "name": "effFruitLevels",
          "module": "treeBuilder",
          "line": 182,
          "exported": false,
          "parent": "treeBuilder:buildTree",
          "calls": [],
          "externalCalls": [],
          "paramRefs": [
            "branches:*",
            "fruit:levels"
          ]
        },
        {
          "id": "treeBuilder:mergeFlowerTemplates",
          "name": "mergeFlowerTemplates",
          "module": "treeBuilder",
          "line": 231,
          "exported": false,
          "parent": "treeBuilder:buildTree",
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeBuilder:makeFlowerTemplate",
          "name": "makeFlowerTemplate",
          "module": "treeBuilder",
          "line": 275,
          "exported": false,
          "parent": "treeBuilder:buildTree",
          "calls": [
            "treeBuilder:mergeFlowerTemplates"
          ],
          "externalCalls": [],
          "paramRefs": [
            "flower:cross"
          ]
        },
        {
          "id": "treeBuilder:addSlot",
          "name": "addSlot",
          "module": "treeBuilder",
          "line": 360,
          "exported": false,
          "parent": "treeBuilder:buildTree",
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeBuilder:spawnLeaves",
          "name": "spawnLeaves",
          "module": "treeBuilder",
          "line": 393,
          "exported": false,
          "parent": "treeBuilder:buildTree",
          "calls": [
            "mathUtils:lerp",
            "mathUtils:sampleFrame",
            "mathUtils:anyPerp",
            "mathUtils:rotateTowardUp",
            "mathUtils:clamp01",
            "treeBuilder:addSlot",
            "leaf:pushLeafInstance"
          ],
          "externalCalls": [
            "rng"
          ],
          "paramRefs": [
            "leaves:enabled",
            "leaves:perBranch",
            "leaves:clusterCount",
            "leaves:startT",
            "leaves:endT",
            "leaves:branchWrap",
            "leaves:branchWrapTurns",
            "leaves:clusterRadius",
            "leaves:clusterSpread",
            "leaves:pitch",
            "leaves:pitchVariance",
            "leaves:droop",
            "leaves:twist",
            "leaves:rollVariance",
            "leaves:faceUp",
            "leaves:modelRotation",
            "leaves:size",
            "leaves:sizeVariance",
            "leaves:cardMode",
            "leaves:cardAspect",
            "leaves:width",
            "leaves:colorVariance",
            "flower:enabled"
          ]
        },
        {
          "id": "treeBuilder:spawnChildren",
          "name": "spawnChildren",
          "module": "treeBuilder",
          "line": 567,
          "exported": false,
          "parent": "treeBuilder:buildTree",
          "calls": [
            "mathUtils:clamp01",
            "mathUtils:lerp",
            "mathUtils:sampleFrame",
            "treeBuilder:childDirection",
            "mathUtils:azimuthPerp",
            "treeBuilder:frameBasisAt",
            "treeBuilder:buildBranch"
          ],
          "externalCalls": [
            "rng"
          ],
          "paramRefs": [
            "branches:enabled",
            "branches:count",
            "branches:startT",
            "branches:endT",
            "branches:startJitter",
            "branches:lengthRatio",
            "branches:lengthVariance",
            "branches:radiusRatio",
            "branches:radiusVariance",
            "branches:taper",
            "branches:phyllotaxis",
            "branches:windGain"
          ]
        },
        {
          "id": "treeBuilder:branchEditOf",
          "name": "branchEditOf",
          "module": "treeBuilder",
          "line": 661,
          "exported": false,
          "parent": "treeBuilder:buildTree",
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeBuilder:applyBranchEdit",
          "name": "applyBranchEdit",
          "module": "treeBuilder",
          "line": 678,
          "exported": false,
          "parent": "treeBuilder:buildTree",
          "calls": [
            "treeBuilder:branchEditOf"
          ],
          "externalCalls": [
            "rng"
          ],
          "paramRefs": []
        },
        {
          "id": "treeBuilder:buildBranch",
          "name": "buildBranch",
          "module": "treeBuilder",
          "line": 740,
          "exported": false,
          "parent": "treeBuilder:buildTree",
          "calls": [
            "mathUtils:growFrames",
            "treeBuilder:applyBranchEdit",
            "treeBuilder:sampleGuidePoints",
            "treeBuilder:addSlot",
            "barkSkeleton:addBarkBranch",
            "treeBuilder:spawnChildren",
            "treeBuilder:spawnLeaves",
            "treeBuilder:spawnFruit"
          ],
          "externalCalls": [
            "rng"
          ],
          "paramRefs": [
            "branches:*",
            "lod:*",
            "leaves:enabled",
            "leaves:levels",
            "fruit:enabled",
            "flower:enabled",
            "branches:radiusCurve",
            "branches:segments",
            "branches:curve",
            "branches:curveVariance",
            "branches:gravity",
            "branches:upBias",
            "branches:twist",
            "branches:twistProfile",
            "branches:taper",
            "branches:nodeRoll",
            "branches:nodeOffset",
            "branches:nodeJumble",
            "branches:nodeRollBias",
            "branches:nodeJumbleBias",
            "branches:spineNoise",
            "branches:radialSegments",
            "branches:crossSection",
            "branches:starDepth",
            "branches:crossNoise"
          ]
        },
        {
          "id": "treeBuilder:trunkRadiusMod",
          "name": "trunkRadiusMod",
          "module": "treeBuilder",
          "line": 912,
          "exported": false,
          "parent": "treeBuilder:buildTree",
          "calls": [
            "mathUtils:organicRingNoise"
          ],
          "externalCalls": [],
          "paramRefs": [
            "trunk:flare",
            "trunk:flareHeight",
            "trunk:spread",
            "trunk:angle"
          ]
        },
        {
          "id": "treeBuilder:spawnFruit",
          "name": "spawnFruit",
          "module": "treeBuilder",
          "line": 1194,
          "exported": false,
          "parent": "treeBuilder:buildTree",
          "calls": [
            "fruit:buildFruitTemplate",
            "mathUtils:sampleFrame",
            "mathUtils:azimuthPerp",
            "treeBuilder:addSlot",
            "fruit:pushFruitInstance"
          ],
          "externalCalls": [
            "rng"
          ],
          "paramRefs": [
            "fruit:perBranch",
            "fruit:clusterCount",
            "fruit:type",
            "fruit:color",
            "fruit:capColor",
            "fruit:radial",
            "fruit:clusterRadius",
            "fruit:size",
            "fruit:sizeVariance",
            "fruit:droop",
            "fruit:maxCount",
            "fruit:chance",
            "fruit:colorVariance"
          ]
        },
        {
          "id": "treeBuilder:projectTOnTrunk",
          "name": "projectTOnTrunk",
          "module": "treeBuilder",
          "line": 1337,
          "exported": false,
          "parent": "treeBuilder:buildTree",
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeBuilder:sampleGuidePoints",
          "name": "sampleGuidePoints",
          "module": "treeBuilder",
          "line": 1735,
          "exported": false,
          "parent": null,
          "calls": [
            "mathUtils:sampleFrame"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeBuilder:emptyBox",
          "name": "emptyBox",
          "module": "treeBuilder",
          "line": 1752,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeBuilder:unionBox",
          "name": "unionBox",
          "module": "treeBuilder",
          "line": 1763,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeBuilder:finalizeNodes",
          "name": "finalizeNodes",
          "module": "treeBuilder",
          "line": 1788,
          "exported": true,
          "parent": null,
          "calls": [
            "treeBuilder:measure",
            "treeBuilder:unionBox"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeBuilder:measure",
          "name": "measure",
          "module": "treeBuilder",
          "line": 1826,
          "exported": false,
          "parent": "treeBuilder:finalizeNodes",
          "calls": [
            "treeBuilder:emptyBox",
            "treeBuilder:unionBox"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeBuilder:selectionRanges",
          "name": "selectionRanges",
          "module": "treeBuilder",
          "line": 1960,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeBuilder:estimateScale",
          "name": "estimateScale",
          "module": "treeBuilder",
          "line": 2003,
          "exported": true,
          "parent": null,
          "calls": [
            "treeBuilder:subtree",
            "treeBuilder:countAt"
          ],
          "externalCalls": [],
          "paramRefs": [
            "branches:*",
            "trunk:*",
            "leaves:*"
          ]
        },
        {
          "id": "treeBuilder:cnt",
          "name": "cnt",
          "module": "treeBuilder",
          "line": 2006,
          "exported": false,
          "parent": "treeBuilder:estimateScale",
          "calls": [],
          "externalCalls": [],
          "paramRefs": [
            "branches:*",
            "branches:enabled",
            "branches:count"
          ]
        },
        {
          "id": "treeBuilder:subtree",
          "name": "subtree",
          "module": "treeBuilder",
          "line": 2015,
          "exported": false,
          "parent": "treeBuilder:estimateScale",
          "calls": [
            "treeBuilder:cnt"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeBuilder:countAt",
          "name": "countAt",
          "module": "treeBuilder",
          "line": 2027,
          "exported": false,
          "parent": "treeBuilder:estimateScale",
          "calls": [
            "treeBuilder:cnt"
          ],
          "externalCalls": [],
          "paramRefs": []
        }
      ]
    },
    {
      "id": "twist",
      "name": "twist",
      "title": "扭曲编辑",
      "category": "几何生成",
      "file": "src/core/twist.js",
      "functions": [
        {
          "id": "twist:defaultTwistProfile",
          "name": "defaultTwistProfile",
          "module": "twist",
          "line": 33,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "twist:normalizeTwistProfile",
          "name": "normalizeTwistProfile",
          "module": "twist",
          "line": 46,
          "exported": true,
          "parent": null,
          "calls": [
            "twist:defaultTwistProfile"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "twist:sampleTwistProfile",
          "name": "sampleTwistProfile",
          "module": "twist",
          "line": 67,
          "exported": true,
          "parent": null,
          "calls": [
            "twist:normalizeTwistProfile"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "twist:twistProfileRad",
          "name": "twistProfileRad",
          "module": "twist",
          "line": 85,
          "exported": true,
          "parent": null,
          "calls": [
            "twist:sampleTwistProfile"
          ],
          "externalCalls": [],
          "paramRefs": []
        }
      ]
    },
    {
      "id": "windModel",
      "name": "windModel",
      "title": "风场模型",
      "category": "场景与风",
      "file": "src/core/windModel.js",
      "functions": [
        {
          "id": "windModel:rotateAroundAxis",
          "name": "rotateAroundAxis",
          "module": "windModel",
          "line": 53,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "windModel:leafTrajectory",
          "name": "leafTrajectory",
          "module": "windModel",
          "line": 103,
          "exported": true,
          "parent": null,
          "calls": [
            "windModel:rotateAroundAxis"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "windModel:motionMetrics",
          "name": "motionMetrics",
          "module": "windModel",
          "line": 209,
          "exported": true,
          "parent": null,
          "calls": [
            "windModel:leafTrajectory"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "windModel:swayEnvelope",
          "name": "swayEnvelope",
          "module": "windModel",
          "line": 291,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        }
      ]
    },
    {
      "id": "treeStore",
      "name": "treeStore",
      "title": "状态仓库",
      "category": "应用与接口",
      "file": "src/store/treeStore.js",
      "functions": [
        {
          "id": "treeStore:getNodeModel",
          "name": "getNodeModel",
          "module": "treeStore",
          "line": 126,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeStore:setNodeModel",
          "name": "setNodeModel",
          "module": "treeStore",
          "line": 142,
          "exported": true,
          "parent": null,
          "calls": [
            "treeStore:refreshSelectionRanges",
            "treeStore:updateSelectionBox"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeStore:refreshSelectionRanges",
          "name": "refreshSelectionRanges",
          "module": "treeStore",
          "line": 169,
          "exported": false,
          "parent": null,
          "calls": [
            "treeBuilder:selectionRanges",
            "treeStore:describeSelection"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeStore:describeSelection",
          "name": "describeSelection",
          "module": "treeStore",
          "line": 187,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeStore:selectNodes",
          "name": "selectNodes",
          "module": "treeStore",
          "line": 223,
          "exported": true,
          "parent": null,
          "calls": [
            "treeStore:refreshSelectionRanges",
            "treeStore:updateSelectionBox"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeStore:selectGroup",
          "name": "selectGroup",
          "module": "treeStore",
          "line": 255,
          "exported": true,
          "parent": null,
          "calls": [
            "treeStore:refreshSelectionRanges",
            "treeStore:selectNodes"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeStore:clearSelection",
          "name": "clearSelection",
          "module": "treeStore",
          "line": 277,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeStore:toggleNodePanel",
          "name": "toggleNodePanel",
          "module": "treeStore",
          "line": 288,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeStore:openNodePanel",
          "name": "openNodePanel",
          "module": "treeStore",
          "line": 294,
          "exported": true,
          "parent": null,
          "calls": [
            "treeStore:selectNodes"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeStore:setSelectionMode",
          "name": "setSelectionMode",
          "module": "treeStore",
          "line": 305,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeStore:focusSelection",
          "name": "focusSelection",
          "module": "treeStore",
          "line": 310,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeStore:focusNode",
          "name": "focusNode",
          "module": "treeStore",
          "line": 319,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeStore:updateSelectionBox",
          "name": "updateSelectionBox",
          "module": "treeStore",
          "line": 333,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeStore:selectionSignature",
          "name": "selectionSignature",
          "module": "treeStore",
          "line": 366,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeStore:snapshot",
          "name": "snapshot",
          "module": "treeStore",
          "line": 399,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeStore:pushUndo",
          "name": "pushUndo",
          "module": "treeStore",
          "line": 412,
          "exported": true,
          "parent": null,
          "calls": [
            "treeStore:snapshot"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeStore:undo",
          "name": "undo",
          "module": "treeStore",
          "line": 432,
          "exported": true,
          "parent": null,
          "calls": [
            "treeStore:snapshot",
            "params:normalizeParams"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeStore:redo",
          "name": "redo",
          "module": "treeStore",
          "line": 445,
          "exported": true,
          "parent": null,
          "calls": [
            "treeStore:snapshot",
            "params:normalizeParams"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeStore:setSeed",
          "name": "setSeed",
          "module": "treeStore",
          "line": 471,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": [
            "seed:*",
            "branchEdits:*"
          ]
        },
        {
          "id": "treeStore:randomizeSeed",
          "name": "randomizeSeed",
          "module": "treeStore",
          "line": 481,
          "exported": true,
          "parent": null,
          "calls": [
            "treeStore:pushUndo",
            "presets:randomSeed",
            "treeStore:randomizeFoliageAssets"
          ],
          "externalCalls": [
            "presets"
          ],
          "paramRefs": [
            "seed:*",
            "branchEdits:*",
            "wind:*"
          ]
        },
        {
          "id": "treeStore:regenerateNow",
          "name": "regenerateNow",
          "module": "treeStore",
          "line": 493,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeStore:doAutoGenerate",
          "name": "doAutoGenerate",
          "module": "treeStore",
          "line": 513,
          "exported": true,
          "parent": null,
          "calls": [
            "treeStore:pushUndo",
            "presets:randomSeed",
            "presets:autoGenerate",
            "params:cloneParams",
            "params:mergeParams",
            "params:normalizeParams"
          ],
          "externalCalls": [],
          "paramRefs": [
            "branchEdits:*",
            "auto:*",
            "scene:*",
            "custom:*",
            "bark:*",
            "leafMat:*",
            "growth:*",
            "lod:*",
            "seed:*",
            "auto:chaos",
            "fruit:type"
          ]
        },
        {
          "id": "treeStore:pickBarkOverrides",
          "name": "pickBarkOverrides",
          "module": "treeStore",
          "line": 551,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": [
            "bark:*"
          ]
        },
        {
          "id": "treeStore:doApplyPreset",
          "name": "doApplyPreset",
          "module": "treeStore",
          "line": 580,
          "exported": true,
          "parent": null,
          "calls": [
            "treeStore:pushUndo",
            "params:normalizeParams"
          ],
          "externalCalls": [
            "presets"
          ],
          "paramRefs": [
            "branchEdits:*",
            "wind:*",
            "seed:*"
          ]
        },
        {
          "id": "treeStore:applyClassification",
          "name": "applyClassification",
          "module": "treeStore",
          "line": 605,
          "exported": true,
          "parent": null,
          "calls": [
            "treeStore:pushUndo",
            "params:normalizeParams"
          ],
          "externalCalls": [
            "presets"
          ],
          "paramRefs": [
            "wind:*",
            "seed:*",
            "classify:*"
          ]
        },
        {
          "id": "treeStore:applyLeafCard",
          "name": "applyLeafCard",
          "module": "treeStore",
          "line": 632,
          "exported": true,
          "parent": null,
          "calls": [
            "treeStore:pushUndo"
          ],
          "externalCalls": [],
          "paramRefs": [
            "leaves:*",
            "leafMat:*",
            "flower:alphaTest"
          ]
        },
        {
          "id": "treeStore:imageAspect",
          "name": "imageAspect",
          "module": "treeStore",
          "line": 664,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeStore:fitLeafCardToTexture",
          "name": "fitLeafCardToTexture",
          "module": "treeStore",
          "line": 680,
          "exported": true,
          "parent": null,
          "calls": [
            "treeStore:imageAspect",
            "treeStore:pushUndo"
          ],
          "externalCalls": [],
          "paramRefs": [
            "leafMat:*",
            "leaves:*"
          ]
        },
        {
          "id": "treeStore:fitFlowerCardToTexture",
          "name": "fitFlowerCardToTexture",
          "module": "treeStore",
          "line": 694,
          "exported": true,
          "parent": null,
          "calls": [
            "treeStore:imageAspect",
            "treeStore:pushUndo"
          ],
          "externalCalls": [],
          "paramRefs": [
            "flower:*"
          ]
        },
        {
          "id": "treeStore:applyFlowerCard",
          "name": "applyFlowerCard",
          "module": "treeStore",
          "line": 709,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": [
            "flower:*"
          ]
        },
        {
          "id": "treeStore:randomFlowerCard",
          "name": "randomFlowerCard",
          "module": "treeStore",
          "line": 731,
          "exported": true,
          "parent": null,
          "calls": [
            "treeStore:applyFlowerCard"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeStore:randomizeFoliageAssets",
          "name": "randomizeFoliageAssets",
          "module": "treeStore",
          "line": 755,
          "exported": true,
          "parent": null,
          "calls": [
            "rng:makeRng"
          ],
          "externalCalls": [
            "leafCards.generated"
          ],
          "paramRefs": [
            "leaves:*",
            "leafMat:*",
            "flower:*"
          ]
        },
        {
          "id": "treeStore:doGenerateImpostor",
          "name": "doGenerateImpostor",
          "module": "treeStore",
          "line": 822,
          "exported": true,
          "parent": null,
          "calls": [
            "treeStore:setImpostorPreview"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeStore:setActiveTab",
          "name": "setActiveTab",
          "module": "treeStore",
          "line": 835,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeStore:setImpostorPreview",
          "name": "setImpostorPreview",
          "module": "treeStore",
          "line": 848,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeStore:downloadImpostor",
          "name": "downloadImpostor",
          "module": "treeStore",
          "line": 868,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeStore:randomLeafCard",
          "name": "randomLeafCard",
          "module": "treeStore",
          "line": 893,
          "exported": true,
          "parent": null,
          "calls": [
            "treeStore:applyLeafCard"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeStore:randomClassification",
          "name": "randomClassification",
          "module": "treeStore",
          "line": 905,
          "exported": true,
          "parent": null,
          "calls": [
            "treeStore:applyClassification"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeStore:setWindIntensity",
          "name": "setWindIntensity",
          "module": "treeStore",
          "line": 913,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [
            "presets"
          ],
          "paramRefs": [
            "wind:*",
            "seed:*"
          ]
        },
        {
          "id": "treeStore:randomizeWind",
          "name": "randomizeWind",
          "module": "treeStore",
          "line": 929,
          "exported": true,
          "parent": null,
          "calls": [
            "treeStore:pushUndo"
          ],
          "externalCalls": [
            "presets"
          ],
          "paramRefs": [
            "wind:*"
          ]
        },
        {
          "id": "treeStore:setWindAuto",
          "name": "setWindAuto",
          "module": "treeStore",
          "line": 942,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [
            "presets"
          ],
          "paramRefs": [
            "wind:*",
            "seed:*"
          ]
        },
        {
          "id": "treeStore:resetSection",
          "name": "resetSection",
          "module": "treeStore",
          "line": 956,
          "exported": true,
          "parent": null,
          "calls": [
            "treeStore:pushUndo"
          ],
          "externalCalls": [],
          "paramRefs": [
            "branches:*"
          ]
        },
        {
          "id": "treeStore:importParamsJSON",
          "name": "importParamsJSON",
          "module": "treeStore",
          "line": 984,
          "exported": true,
          "parent": null,
          "calls": [
            "treeStore:pushUndo",
            "params:normalizeParams"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeStore:loadFtreeHistory",
          "name": "loadFtreeHistory",
          "module": "treeStore",
          "line": 1000,
          "exported": true,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeStore:persistFtreeHistory",
          "name": "persistFtreeHistory",
          "module": "treeStore",
          "line": 1010,
          "exported": false,
          "parent": null,
          "calls": [],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeStore:pushFtreeHistory",
          "name": "pushFtreeHistory",
          "module": "treeStore",
          "line": 1017,
          "exported": false,
          "parent": null,
          "calls": [
            "treeStore:persistFtreeHistory"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeStore:clearFtreeHistory",
          "name": "clearFtreeHistory",
          "module": "treeStore",
          "line": 1026,
          "exported": true,
          "parent": null,
          "calls": [
            "treeStore:persistFtreeHistory"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeStore:doExportFtree",
          "name": "doExportFtree",
          "module": "treeStore",
          "line": 1036,
          "exported": true,
          "parent": null,
          "calls": [
            "ftree:exportFtree",
            "treeStore:pushFtreeHistory"
          ],
          "externalCalls": [],
          "paramRefs": [
            "seed:*"
          ]
        },
        {
          "id": "treeStore:doImportFtree",
          "name": "doImportFtree",
          "module": "treeStore",
          "line": 1055,
          "exported": true,
          "parent": null,
          "calls": [
            "ftree:loadFtreeFile",
            "treeStore:pushUndo",
            "treeStore:pushFtreeHistory"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeStore:loadTemplates",
          "name": "loadTemplates",
          "module": "treeStore",
          "line": 1080,
          "exported": true,
          "parent": null,
          "calls": [
            "templateDb:listTemplates"
          ],
          "externalCalls": [],
          "paramRefs": []
        },
        {
          "id": "treeStore:suggestTemplateName",
          "name": "suggestTemplateName",
          "module": "treeStore",
          "line": 1094,
          "exported": true,
          "parent": null,
          "calls": [
            "presets:archetypeName"
          ],
          "externalCalls": [],
          "paramRefs": [
            "classify:*"
          ]
        }
      ]
    }
  ],
  "callEdges": [
    {
      "from": "ambientOcclusion:bakeOcclusion",
      "to": "ambientOcclusion:occlusionAt"
    },
    {
      "from": "ambientOcclusion:bakeOcclusion",
      "to": "ambientOcclusion:percentile"
    },
    {
      "from": "ambientOcclusion:bakeOcclusionByRanges",
      "to": "ambientOcclusion:occlusionAt"
    },
    {
      "from": "ambientOcclusion:bakeOcclusionByRanges",
      "to": "ambientOcclusion:percentile"
    },
    {
      "from": "appApi:startBridgeClient",
      "to": "appApi:registerConsumer"
    },
    {
      "from": "appApi:startBridgeClient",
      "to": "appApi:runCommand"
    },
    {
      "from": "barkSkeleton:finalizeBarkSkeleton",
      "to": "barkSkeleton:projectOnSegment"
    },
    {
      "from": "barkSkin:ringModifier",
      "to": "barkSkin:smoothstep01"
    },
    {
      "from": "barkSkin:averageRingRadius",
      "to": "barkSkin:ringModifier"
    },
    {
      "from": "barkSkin:childBaseRadius",
      "to": "barkSkin:ringModifier"
    },
    {
      "from": "barkSkin:planBranchWindows",
      "to": "barkSkin:baseRadialSegments"
    },
    {
      "from": "barkSkin:planBranchWindows",
      "to": "barkSkin:averageRingRadius"
    },
    {
      "from": "barkSkin:planBranchWindows",
      "to": "barkSkin:buildGroups"
    },
    {
      "from": "barkSkin:planBranchWindows",
      "to": "barkSkin:requiredM"
    },
    {
      "from": "barkSkin:planBranchWindows",
      "to": "barkSkin:placeWindows"
    },
    {
      "from": "barkSkin:placeWindows",
      "to": "barkSkin:rangeFree"
    },
    {
      "from": "barkSkin:placeWindows",
      "to": "barkSkin:colFree"
    },
    {
      "from": "barkSkin:placeWindows",
      "to": "barkSkin:mark"
    },
    {
      "from": "barkSkin:colFree",
      "to": "barkSkin:getOcc"
    },
    {
      "from": "barkSkin:mark",
      "to": "barkSkin:getOcc"
    },
    {
      "from": "barkSkin:rangeFree",
      "to": "barkSkin:colFree"
    },
    {
      "from": "barkSkin:sampleLoopVertex",
      "to": "barkSkin:readVertex"
    },
    {
      "from": "barkSkin:sampleLoopVertex",
      "to": "barkSkin:closedParams"
    },
    {
      "from": "barkSkin:sampleLoopVertex",
      "to": "barkSkin:distanceBetween"
    },
    {
      "from": "barkSkin:sampleLoopVertex",
      "to": "barkSkin:mixVertex"
    },
    {
      "from": "barkSkin:buildCollarLoop",
      "to": "barkSkin:sampleLoopVertex"
    },
    {
      "from": "barkSkin:buildCollarLoop",
      "to": "barkSkin:mixVertex"
    },
    {
      "from": "barkSkin:stitchLoops",
      "to": "barkSkin:closedParams"
    },
    {
      "from": "barkSkin:buildSkinFrames",
      "to": "barkSkin:childAttachT"
    },
    {
      "from": "barkSkin:buildSkinFrames",
      "to": "barkSkin:childBaseRadius"
    },
    {
      "from": "barkSkin:buildSkinFrames",
      "to": "barkSkin:sampleSkinFrame"
    },
    {
      "from": "barkSkin:buildBarkSkin",
      "to": "barkSkin:buildSkinFrames"
    },
    {
      "from": "barkSkin:buildBarkSkin",
      "to": "barkSkin:buildRingBases"
    },
    {
      "from": "barkSkin:buildBarkSkin",
      "to": "barkSkin:childAttachT"
    },
    {
      "from": "barkSkin:buildBarkSkin",
      "to": "barkSkin:findBandAt"
    },
    {
      "from": "barkSkin:buildBarkSkin",
      "to": "barkSkin:childBaseRadius"
    },
    {
      "from": "barkSkin:buildBarkSkin",
      "to": "barkSkin:planBranchWindows"
    },
    {
      "from": "barkSkin:buildBarkSkin",
      "to": "barkSkin:baseRadialSegments"
    },
    {
      "from": "barkSkin:buildBarkSkin",
      "to": "barkSkin:rgb"
    },
    {
      "from": "barkSkin:buildBarkSkin",
      "to": "barkSkin:vec3"
    },
    {
      "from": "barkSkin:buildBarkSkin",
      "to": "barkSkin:ringModifier"
    },
    {
      "from": "barkSkin:buildBarkSkin",
      "to": "barkSkin:bestRotation"
    },
    {
      "from": "barkSkin:buildBarkSkin",
      "to": "barkSkin:buildCollarLoop"
    },
    {
      "from": "barkSkin:buildBarkSkin",
      "to": "barkSkin:stitchLoops"
    },
    {
      "from": "barkSkin:buildBarkSkin",
      "to": "barkSkin:distanceBetween"
    },
    {
      "from": "environments:applyEnvironment",
      "to": "environments:envById"
    },
    {
      "from": "exporter:downloadText",
      "to": "exporter:downloadBlob"
    },
    {
      "from": "exporter:exportGLB",
      "to": "exporter:restoreAll"
    },
    {
      "from": "exporter:exportGLB",
      "to": "exporter:downloadBlob"
    },
    {
      "from": "exporter:exportOBJ",
      "to": "exporter:expandExponentialNumbers"
    },
    {
      "from": "exporter:exportOBJ",
      "to": "exporter:downloadText"
    },
    {
      "from": "exporter:exportParamsJSON",
      "to": "exporter:buildParamsJSON"
    },
    {
      "from": "exporter:exportParamsJSON",
      "to": "exporter:downloadText"
    },
    {
      "from": "exporter:exportScreenshot",
      "to": "exporter:downloadBlob"
    },
    {
      "from": "exportPreview:exportNodeList",
      "to": "exportPreview:triangleCount"
    },
    {
      "from": "exportPreview:exportNodeList",
      "to": "exportPreview:vertexCount"
    },
    {
      "from": "exportPreview:glbImageArtifacts",
      "to": "exportPreview:imageNameLookup"
    },
    {
      "from": "exportPreview:glbImageArtifacts",
      "to": "exportPreview:extForMime"
    },
    {
      "from": "exportPreview:buildGLBPreview",
      "to": "exportPreview:exportNodeList"
    },
    {
      "from": "exportPreview:buildGLBPreview",
      "to": "exporter:exportGLB"
    },
    {
      "from": "exportPreview:buildGLBPreview",
      "to": "exportPreview:parseGLB"
    },
    {
      "from": "exportPreview:buildGLBPreview",
      "to": "exportPreview:glbImageArtifacts"
    },
    {
      "from": "exportPreview:buildOBJPreview",
      "to": "exportPreview:exportNodeList"
    },
    {
      "from": "exportPreview:buildOBJPreview",
      "to": "exporter:exportOBJ"
    },
    {
      "from": "exportSplit:barkExportParts",
      "to": "exportSplit:splitBarkGeometryByNodeGroups"
    },
    {
      "from": "exportSplit:splitBarkGeometryByNodeGroups",
      "to": "exportSplit:labelOf"
    },
    {
      "from": "exportSplit:splitBarkGeometryByNodeGroups",
      "to": "exportSplit:ensureGroup"
    },
    {
      "from": "exportSplit:splitBarkGeometryByNodeGroups",
      "to": "exportSplit:order"
    },
    {
      "from": "exportSplit:labelOf",
      "to": "exportSplit:barkGroupName"
    },
    {
      "from": "fallingLeaves:updateFallingLeaves",
      "to": "fallingLeaves:writeEffectUniforms"
    },
    {
      "from": "forceField:normalizeForceItem",
      "to": "forceField:clamp"
    },
    {
      "from": "forceField:createForceField",
      "to": "forceField:normalizeForces"
    },
    {
      "from": "forceField:createForceField",
      "to": "forceField:rotationMatrix"
    },
    {
      "from": "forceField:apply",
      "to": "forceField:shapeField"
    },
    {
      "from": "fruit:buildFruitTemplate",
      "to": "fruit:lathe"
    },
    {
      "from": "fruitMaterial:makeDetailPixels",
      "to": "fruitMaterial:makeCanvas"
    },
    {
      "from": "fruitMaterial:makeDiffuseTexture",
      "to": "fruitMaterial:makeCanvas"
    },
    {
      "from": "fruitMaterial:makeAlphaMaskDataUrl",
      "to": "fruitMaterial:makeCanvas"
    },
    {
      "from": "fruitMaterial:createFruitExportMaterial",
      "to": "fruitMaterial:makeDetailPixels"
    },
    {
      "from": "fruitMaterial:createFruitExportMaterial",
      "to": "fruitMaterial:makeDiffuseTexture"
    },
    {
      "from": "fruitMaterial:createFruitExportMaterial",
      "to": "fruitMaterial:makeAlphaMaskDataUrl"
    },
    {
      "from": "ftree:extractTextures",
      "to": "ftree:getAt"
    },
    {
      "from": "ftree:extractTextures",
      "to": "ftree:parseDataUrl"
    },
    {
      "from": "ftree:extractTextures",
      "to": "ftree:base64ToBytes"
    },
    {
      "from": "ftree:extractTextures",
      "to": "ftree:setAt"
    },
    {
      "from": "ftree:injectTextures",
      "to": "ftree:setAt"
    },
    {
      "from": "ftree:buildFtree",
      "to": "ftree:extractTextures"
    },
    {
      "from": "ftree:exportFtree",
      "to": "ftree:buildFtree"
    },
    {
      "from": "ftree:exportFtree",
      "to": "exporter:downloadBlob"
    },
    {
      "from": "ftree:parseFtree",
      "to": "ftree:injectTextures"
    },
    {
      "from": "ftree:loadFtreeFile",
      "to": "ftree:parseFtree"
    },
    {
      "from": "impostor:generateImpostor",
      "to": "impostor:addLight"
    },
    {
      "from": "impostor:generateImpostor",
      "to": "impostor:crossCardQuads"
    },
    {
      "from": "impostor:generateImpostor",
      "to": "impostor:viewAngles"
    },
    {
      "from": "impostor:generateImpostor",
      "to": "impostor:elevationAngles"
    },
    {
      "from": "impostor:generateImpostor",
      "to": "impostor:renderView"
    },
    {
      "from": "impostor:generateImpostor",
      "to": "impostor:alphaCoverage"
    },
    {
      "from": "impostor:generateImpostor",
      "to": "impostor:pixelsToImageData"
    },
    {
      "from": "leafTexture:resolveEffectTexture",
      "to": "leafTexture:cardTexture"
    },
    {
      "from": "leafTexture:resolveEffectTexture",
      "to": "leafTexture:ellipseLeafTexture"
    },
    {
      "from": "litter:effectUniforms",
      "to": "leafEffects:resolveLeafEffects"
    },
    {
      "from": "litter:updateLitterEffects",
      "to": "leafEffects:resolveLeafEffects"
    },
    {
      "from": "litter:buildLeafLitter",
      "to": "leafTexture:resolveEffectAspect"
    },
    {
      "from": "litter:buildLeafLitter",
      "to": "leafTexture:resolveEffectTexture"
    },
    {
      "from": "materialPreview:render",
      "to": "materialPreview:placeCamera"
    },
    {
      "from": "materialPreview:setParams",
      "to": "materialPreview:render"
    },
    {
      "from": "materialPreview:setParams",
      "to": "materialPreview:scheduleRetries"
    },
    {
      "from": "materialPreview:onMove",
      "to": "materialPreview:render"
    },
    {
      "from": "materialPreview:rotateBy",
      "to": "materialPreview:render"
    },
    {
      "from": "materials:perMaterialUniforms",
      "to": "materials:resolveTintMix"
    },
    {
      "from": "materials:perMaterialUniforms",
      "to": "materials:whitePixelTexture"
    },
    {
      "from": "materials:applyTreeShader",
      "to": "materials:vertexBody"
    },
    {
      "from": "materials:applyTreeShader",
      "to": "materials:fragmentBody"
    },
    {
      "from": "materials:createTreeDepthMaterial",
      "to": "materials:vertexBody"
    },
    {
      "from": "materials:createBarkMaterial",
      "to": "materials:perMaterialUniforms"
    },
    {
      "from": "materials:createBarkMaterial",
      "to": "materials:applyTreeShader"
    },
    {
      "from": "materials:createBarkMaterial",
      "to": "materials:updateBarkMaterial"
    },
    {
      "from": "materials:createFlowerMaterial",
      "to": "materials:createLeafMaterial"
    },
    {
      "from": "materials:updateFlowerMaterial",
      "to": "materials:updateLeafMaterial"
    },
    {
      "from": "materials:updateFlowerMaterial",
      "to": "materials:flowerLeafParams"
    },
    {
      "from": "materials:createLeafMaterial",
      "to": "materials:perMaterialUniforms"
    },
    {
      "from": "materials:createLeafMaterial",
      "to": "materials:applyTreeShader"
    },
    {
      "from": "materials:createLeafMaterial",
      "to": "materials:updateLeafMaterial"
    },
    {
      "from": "materials:updateBarkMaterial",
      "to": "materials:clearAutoBarkTextures"
    },
    {
      "from": "materials:updateBarkMaterial",
      "to": "materials:applyAutoNormal"
    },
    {
      "from": "materials:updateLeafMaterial",
      "to": "materials:resolveTintMix"
    },
    {
      "from": "materials:updateLeafMaterial",
      "to": "materials:whitePixelTexture"
    },
    {
      "from": "materials:updateLeafMaterial",
      "to": "materials:applyAutoNormal"
    },
    {
      "from": "materials:updateMaterials",
      "to": "materials:updateBarkMaterial"
    },
    {
      "from": "materials:updateMaterials",
      "to": "materials:updateLeafMaterial"
    },
    {
      "from": "materials:updateMaterials",
      "to": "materials:updateFlowerMaterial"
    },
    {
      "from": "materials:updateMaterials",
      "to": "materials:updateWindUniforms"
    },
    {
      "from": "materials:rebindCustomShader",
      "to": "materials:applyTreeShader"
    },
    {
      "from": "mathUtils:smoothstep",
      "to": "mathUtils:clamp01"
    },
    {
      "from": "mathUtils:azimuthPerp",
      "to": "mathUtils:anyPerp"
    },
    {
      "from": "mathUtils:sampleFrame",
      "to": "mathUtils:clamp01"
    },
    {
      "from": "mathUtils:sampleFrame",
      "to": "mathUtils:lerp"
    },
    {
      "from": "mathUtils:growFrames",
      "to": "mathUtils:anyPerp"
    },
    {
      "from": "mathUtils:growFrames",
      "to": "mathUtils:smoothstep"
    },
    {
      "from": "mathUtils:growFrames",
      "to": "mathUtils:organicNoise1"
    },
    {
      "from": "mathUtils:growFrames",
      "to": "mathUtils:rotateTowardUp"
    },
    {
      "from": "meshTopology:analyzeTopology",
      "to": "meshTopology:resolve"
    },
    {
      "from": "meshTopology:analyzeTopology",
      "to": "meshTopology:edgeKey"
    },
    {
      "from": "meshTopology:analyzeTopology",
      "to": "meshTopology:find2"
    },
    {
      "from": "meshTopology:analyzeTopology",
      "to": "meshTopology:addLink"
    },
    {
      "from": "meshTopology:validateSkin",
      "to": "meshTopology:analyzeTopology"
    },
    {
      "from": "meshTopology:validateSkin",
      "to": "meshTopology:branchSkinCoverage"
    },
    {
      "from": "normalFromAlbedo:normalFromLuminance",
      "to": "normalFromAlbedo:at"
    },
    {
      "from": "normalFromAlbedo:albedoNormalTexture",
      "to": "normalFromAlbedo:normalFromLuminance"
    },
    {
      "from": "paramDocs:docFor",
      "to": "paramDocs:normalize"
    },
    {
      "from": "params:ensureFeatureDefaults",
      "to": "params:defaultParams"
    },
    {
      "from": "params:ensureFeatureDefaults",
      "to": "params:fill"
    },
    {
      "from": "params:defaultParams",
      "to": "params:defaultLevel"
    },
    {
      "from": "params:mergeParams",
      "to": "params:cloneParams"
    },
    {
      "from": "params:mergeParams",
      "to": "params:walk"
    },
    {
      "from": "params:normalizeParams",
      "to": "params:mergeParams"
    },
    {
      "from": "params:normalizeParams",
      "to": "forceField:normalizeForces"
    },
    {
      "from": "params:normalizeParams",
      "to": "params:defaultLevel"
    },
    {
      "from": "params:serializeGroup",
      "to": "params:pickStringify"
    },
    {
      "from": "particles:buildParticlePoints",
      "to": "particles:sampleEmitPositions"
    },
    {
      "from": "particles:buildParticlePoints",
      "to": "particles:buildParticleSeeds"
    },
    {
      "from": "particles:buildParticlePoints",
      "to": "particles:createParticleMaterial"
    },
    {
      "from": "particles:buildParticlePoints",
      "to": "particles:updateParticleMaterial"
    },
    {
      "from": "presets:applyPreset",
      "to": "presets:preserveUserBits"
    },
    {
      "from": "presets:autoGenerate",
      "to": "presets:weightedPick"
    },
    {
      "from": "presets:archetypeName",
      "to": "presets:presetById"
    },
    {
      "from": "propertySearch:searchLabels",
      "to": "paramDocs:docFor"
    },
    {
      "from": "rng:mixSeed",
      "to": "rng:hashString"
    },
    {
      "from": "rng:constructor",
      "to": "rng:mixSeed"
    },
    {
      "from": "rng:constructor",
      "to": "rng:mulberry32"
    },
    {
      "from": "sceneManager:bindTransformDrag",
      "to": "sceneManager:start"
    },
    {
      "from": "sceneManager:bindTransformDrag",
      "to": "sceneManager:end"
    },
    {
      "from": "sceneManager:constructor",
      "to": "sceneManager:bindTransformDrag"
    },
    {
      "from": "sceneManager:constructor",
      "to": "materials:createSharedUniforms"
    },
    {
      "from": "sceneManager:_createStars",
      "to": "rng:makeRng"
    },
    {
      "from": "sceneManager:ensureMaterials",
      "to": "materials:createBarkMaterial"
    },
    {
      "from": "sceneManager:ensureMaterials",
      "to": "materials:createLeafMaterial"
    },
    {
      "from": "sceneManager:ensureMaterials",
      "to": "materials:createFlowerMaterial"
    },
    {
      "from": "sceneManager:updateMaterialParams",
      "to": "materials:updateMaterials"
    },
    {
      "from": "sceneManager:updateWind",
      "to": "materials:updateWindUniforms"
    },
    {
      "from": "sceneManager:build",
      "to": "materials:updateMaterials"
    },
    {
      "from": "sceneManager:build",
      "to": "mathUtils:boxInfo"
    },
    {
      "from": "sceneManager:_updateSkeletonOverlay",
      "to": "sceneManager:colorOf"
    },
    {
      "from": "sceneManager:_buildCullChunks",
      "to": "sceneManager:add"
    },
    {
      "from": "sceneManager:add",
      "to": "renderChunks:buildFrustumChunks"
    },
    {
      "from": "sceneManager:add",
      "to": "renderChunks:hideSourceMesh"
    },
    {
      "from": "sceneManager:_ensureLod",
      "to": "params:cloneParams"
    },
    {
      "from": "sceneManager:_depthMaterialFor",
      "to": "materials:createTreeDepthMaterial"
    },
    {
      "from": "sceneManager:updateGrowth",
      "to": "materials:updateGrowthUniforms"
    },
    {
      "from": "sceneManager:applyWireframe",
      "to": "sceneManager:mk"
    },
    {
      "from": "sceneManager:rebuildParticles",
      "to": "particles:buildParticlePoints"
    },
    {
      "from": "sceneManager:updateParticles",
      "to": "particles:updateParticleMaterial"
    },
    {
      "from": "sceneManager:rebuildFall",
      "to": "fallingLeaves:buildFallingLeaves"
    },
    {
      "from": "sceneManager:updateFall",
      "to": "fallingLeaves:fallRebuildKey"
    },
    {
      "from": "sceneManager:updateFall",
      "to": "fallingLeaves:updateFallingLeaves"
    },
    {
      "from": "sceneManager:rebuildFlowerFall",
      "to": "fallingLeaves:buildFallingLeaves"
    },
    {
      "from": "sceneManager:updateFlowerFall",
      "to": "fallingLeaves:fallRebuildKey"
    },
    {
      "from": "sceneManager:updateFlowerFall",
      "to": "fallingLeaves:updateFallingLeaves"
    },
    {
      "from": "sceneManager:rebuildFlowerLitter",
      "to": "litter:buildLeafLitter"
    },
    {
      "from": "sceneManager:updateFlowerLitter",
      "to": "litter:litterRebuildKey"
    },
    {
      "from": "sceneManager:updateFlowerLitter",
      "to": "litter:updateLitterEffects"
    },
    {
      "from": "sceneManager:rebuildLitter",
      "to": "litter:buildLeafLitter"
    },
    {
      "from": "sceneManager:updateLitter",
      "to": "litter:litterRebuildKey"
    },
    {
      "from": "sceneManager:updateLitter",
      "to": "litter:updateLitterEffects"
    },
    {
      "from": "sceneManager:makeImpostor",
      "to": "impostor:generateImpostor"
    },
    {
      "from": "sceneManager:_getFruitExportMaterial",
      "to": "fruitMaterial:disposeFruitExportMaterial"
    },
    {
      "from": "sceneManager:_getFruitExportMaterial",
      "to": "fruitMaterial:createFruitExportMaterial"
    },
    {
      "from": "sceneManager:buildExportGroup",
      "to": "exportSplit:barkExportParts"
    },
    {
      "from": "sceneManager:buildExportGroup",
      "to": "sceneManager:add"
    },
    {
      "from": "sceneManager:prepareExport",
      "to": "exportPreview:buildGLBPreview"
    },
    {
      "from": "sceneManager:prepareExport",
      "to": "exportPreview:buildOBJPreview"
    },
    {
      "from": "sceneManager:prepareExport",
      "to": "exportPreview:buildPNGPreview"
    },
    {
      "from": "sceneManager:screenshot",
      "to": "exporter:exportScreenshot"
    },
    {
      "from": "sceneManager:dispose",
      "to": "fruitMaterial:disposeFruitExportMaterial"
    },
    {
      "from": "species:levels",
      "to": "params:defaultLevel"
    },
    {
      "from": "species:seasonProfile",
      "to": "species:seasonById"
    },
    {
      "from": "species:composeTree",
      "to": "species:speciesById"
    },
    {
      "from": "species:composeTree",
      "to": "species:stageById"
    },
    {
      "from": "species:composeTree",
      "to": "rng:makeRng"
    },
    {
      "from": "species:composeTree",
      "to": "params:mergeParams"
    },
    {
      "from": "species:composeTree",
      "to": "species:applyVariation"
    },
    {
      "from": "species:composeTree",
      "to": "species:applyStage"
    },
    {
      "from": "species:composeTree",
      "to": "species:applySeason"
    },
    {
      "from": "species:composeTree",
      "to": "species:seasonProfile"
    },
    {
      "from": "species:classificationName",
      "to": "species:speciesById"
    },
    {
      "from": "species:classificationName",
      "to": "species:stageById"
    },
    {
      "from": "species:classificationName",
      "to": "species:seasonById"
    },
    {
      "from": "species:classificationName",
      "to": "species:seasonProfile"
    },
    {
      "from": "species:classificationDesc",
      "to": "species:speciesById"
    },
    {
      "from": "species:classificationDesc",
      "to": "species:stageById"
    },
    {
      "from": "species:classificationDesc",
      "to": "species:seasonProfile"
    },
    {
      "from": "species:classificationDesc",
      "to": "species:seasonById"
    },
    {
      "from": "species:allCombinations",
      "to": "species:classificationName"
    },
    {
      "from": "speedtreeBark:ringModifier",
      "to": "speedtreeBark:smooth01"
    },
    {
      "from": "speedtreeBark:buildSpeedtreeBark",
      "to": "speedtreeBark:tubeFrames"
    },
    {
      "from": "speedtreeBark:buildSpeedtreeBark",
      "to": "speedtreeBark:buildRingBases"
    },
    {
      "from": "speedtreeBark:buildSpeedtreeBark",
      "to": "speedtreeBark:rgb"
    },
    {
      "from": "speedtreeBark:buildSpeedtreeBark",
      "to": "speedtreeBark:ringModifier"
    },
    {
      "from": "speedtreeBark:buildSpeedtreeBark",
      "to": "speedtreeBark:smooth01"
    },
    {
      "from": "speedtreeBark:buildSpeedtreeBark",
      "to": "meshTopology:analyzeTopology"
    },
    {
      "from": "speedtreeBark:buildSpeedtreeBark",
      "to": "meshTopology:branchSkinCoverage"
    },
    {
      "from": "templateDb:openDb",
      "to": "templateDb:templatesSupported"
    },
    {
      "from": "templateDb:withStore",
      "to": "templateDb:openDb"
    },
    {
      "from": "templateDb:listTemplates",
      "to": "templateDb:templatesSupported"
    },
    {
      "from": "templateDb:listTemplates",
      "to": "templateDb:openDb"
    },
    {
      "from": "templateDb:getTemplate",
      "to": "templateDb:templatesSupported"
    },
    {
      "from": "templateDb:getTemplate",
      "to": "templateDb:openDb"
    },
    {
      "from": "templateDb:putTemplate",
      "to": "templateDb:templatesSupported"
    },
    {
      "from": "templateDb:putTemplate",
      "to": "templateDb:withStore"
    },
    {
      "from": "templateDb:deleteTemplate",
      "to": "templateDb:templatesSupported"
    },
    {
      "from": "templateDb:deleteTemplate",
      "to": "templateDb:withStore"
    },
    {
      "from": "templateDb:clearTemplates",
      "to": "templateDb:templatesSupported"
    },
    {
      "from": "templateDb:clearTemplates",
      "to": "templateDb:withStore"
    },
    {
      "from": "textureNaming:textureResolutionK",
      "to": "textureNaming:imageSize"
    },
    {
      "from": "textureNaming:makeNormalTextureFromTexture",
      "to": "textureNaming:drawTextureToCanvas"
    },
    {
      "from": "textureNaming:makeNormalTextureFromTexture",
      "to": "textureNaming:makeNormalTextureFromPixels"
    },
    {
      "from": "textureNaming:makeRoughnessTextureFromTexture",
      "to": "textureNaming:drawTextureToCanvas"
    },
    {
      "from": "textureNaming:makeRoughnessTextureFromTexture",
      "to": "textureNaming:lumAt"
    },
    {
      "from": "textureNaming:makeAlphaDataUrl",
      "to": "textureNaming:drawTextureToCanvas"
    },
    {
      "from": "textureNaming:textureAssetName",
      "to": "textureNaming:textureResolutionK"
    },
    {
      "from": "textureNaming:applyExportTextureNames",
      "to": "textureNaming:add"
    },
    {
      "from": "textureNaming:applyExportTextureNames",
      "to": "textureNaming:textureAssetName"
    },
    {
      "from": "textureNaming:applyExportTextureNames",
      "to": "textureNaming:imageSize"
    },
    {
      "from": "textureNaming:applyExportTextureNames",
      "to": "textureNaming:makeAlphaDataUrl"
    },
    {
      "from": "textureNaming:add",
      "to": "textureNaming:textureAssetName"
    },
    {
      "from": "textureNaming:add",
      "to": "textureNaming:imageSize"
    },
    {
      "from": "textureNaming:add",
      "to": "textureNaming:textureResolutionK"
    },
    {
      "from": "textureNaming:patchGlbTextureNames",
      "to": "textureNaming:readGlb"
    },
    {
      "from": "textureNaming:patchGlbTextureNames",
      "to": "textureNaming:padJson"
    },
    {
      "from": "textureNaming:patchGlbTextureNames",
      "to": "textureNaming:writeGlb"
    },
    {
      "from": "textureNaming:makeFlatNormalTexture",
      "to": "textureNaming:makeCanvasTexture"
    },
    {
      "from": "textureNaming:makeFlatRoughnessTexture",
      "to": "textureNaming:makeCanvasTexture"
    },
    {
      "from": "textureNaming:fallbackSize",
      "to": "textureNaming:imageSize"
    },
    {
      "from": "textureNaming:ensureExportMaterialMaps",
      "to": "textureNaming:fallbackSize"
    },
    {
      "from": "textureNaming:ensureExportMaterialMaps",
      "to": "textureNaming:makeNormalTextureFromTexture"
    },
    {
      "from": "textureNaming:ensureExportMaterialMaps",
      "to": "textureNaming:makeFlatNormalTexture"
    },
    {
      "from": "textureNaming:ensureExportMaterialMaps",
      "to": "textureNaming:makeRoughnessTextureFromTexture"
    },
    {
      "from": "textureNaming:ensureExportMaterialMaps",
      "to": "textureNaming:makeFlatRoughnessTexture"
    },
    {
      "from": "textureNaming:resampleExportMap",
      "to": "textureNaming:drawTextureToCanvas"
    },
    {
      "from": "textureNaming:ensureExportTextureAlignment",
      "to": "textureNaming:imageSize"
    },
    {
      "from": "textureNaming:ensureExportTextureAlignment",
      "to": "textureNaming:put"
    },
    {
      "from": "textureNaming:ensureExportTextureAlignment",
      "to": "textureNaming:makeNormalTextureFromTexture"
    },
    {
      "from": "textureNaming:ensureExportTextureAlignment",
      "to": "textureNaming:sameSize"
    },
    {
      "from": "textureNaming:ensureExportTextureAlignment",
      "to": "textureNaming:resampleExportMap"
    },
    {
      "from": "textureNaming:ensureExportTextureAlignment",
      "to": "textureNaming:makeRoughnessTextureFromTexture"
    },
    {
      "from": "textureNaming:sameSize",
      "to": "textureNaming:imageSize"
    },
    {
      "from": "textureNaming:ensureExportUvBake",
      "to": "textureNaming:sameUvTransform"
    },
    {
      "from": "textures:makeBarkTextures",
      "to": "textures:valueNoise2D"
    },
    {
      "from": "textures:makeBarkTextures",
      "to": "textures:createCanvas"
    },
    {
      "from": "textures:makeBarkTextures",
      "to": "textures:fbm"
    },
    {
      "from": "textures:makeBarkTextures",
      "to": "textures:clamp01"
    },
    {
      "from": "textures:makeLeafTexture",
      "to": "textures:valueNoise2D"
    },
    {
      "from": "textures:makeLeafTexture",
      "to": "textures:createCanvas"
    },
    {
      "from": "textures:makeLeafTexture",
      "to": "textures:clamp01"
    },
    {
      "from": "textures:makeLeafTexture",
      "to": "textures:fbm"
    },
    {
      "from": "textures:repairCardAlpha",
      "to": "textures:pushIfTransparent"
    },
    {
      "from": "textures:makeSeamlessCanvas",
      "to": "textures:diffCol"
    },
    {
      "from": "textures:makeSeamlessCanvas",
      "to": "textures:diffRow"
    },
    {
      "from": "textures:makeSeamlessCanvas",
      "to": "textures:bandRatio"
    },
    {
      "from": "textures:loadTexture",
      "to": "textures:makeSeamlessCanvas"
    },
    {
      "from": "textures:loadTexture",
      "to": "textures:repairCardAlpha"
    },
    {
      "from": "textures:loadTexture",
      "to": "textures:clearCardBorder"
    },
    {
      "from": "treeBuilder:childDirection",
      "to": "mathUtils:anyPerp"
    },
    {
      "from": "treeBuilder:childDirection",
      "to": "mathUtils:rotateTowardUp"
    },
    {
      "from": "treeBuilder:frameBasisAt",
      "to": "mathUtils:clamp01"
    },
    {
      "from": "treeBuilder:frameBasisAt",
      "to": "mathUtils:anyPerp"
    },
    {
      "from": "treeBuilder:buildTree",
      "to": "treeBuilder:now"
    },
    {
      "from": "treeBuilder:buildTree",
      "to": "forceField:createForceField"
    },
    {
      "from": "treeBuilder:buildTree",
      "to": "barkSkeleton:createBarkSkeleton"
    },
    {
      "from": "treeBuilder:buildTree",
      "to": "leaf:buildLeafTemplate"
    },
    {
      "from": "treeBuilder:buildTree",
      "to": "leaf:buildLeafCardTemplate"
    },
    {
      "from": "treeBuilder:buildTree",
      "to": "mathUtils:growFrames"
    },
    {
      "from": "treeBuilder:buildTree",
      "to": "treeBuilder:sampleGuidePoints"
    },
    {
      "from": "treeBuilder:buildTree",
      "to": "mathUtils:clamp01"
    },
    {
      "from": "treeBuilder:buildTree",
      "to": "treeBuilder:applyBranchEdit"
    },
    {
      "from": "treeBuilder:buildTree",
      "to": "treeBuilder:addSlot"
    },
    {
      "from": "treeBuilder:buildTree",
      "to": "barkSkeleton:addBarkBranch"
    },
    {
      "from": "treeBuilder:buildTree",
      "to": "mathUtils:sampleFrame"
    },
    {
      "from": "treeBuilder:buildTree",
      "to": "treeBuilder:frameBasisAt"
    },
    {
      "from": "treeBuilder:buildTree",
      "to": "treeBuilder:spawnChildren"
    },
    {
      "from": "treeBuilder:buildTree",
      "to": "treeBuilder:projectTOnTrunk"
    },
    {
      "from": "treeBuilder:buildTree",
      "to": "mathUtils:azimuthPerp"
    },
    {
      "from": "treeBuilder:buildTree",
      "to": "mathUtils:rotateTowardUp"
    },
    {
      "from": "treeBuilder:buildTree",
      "to": "treeBuilder:buildBranch"
    },
    {
      "from": "treeBuilder:buildTree",
      "to": "barkSkeleton:finalizeBarkSkeleton"
    },
    {
      "from": "treeBuilder:buildTree",
      "to": "barkSkeleton:enforceChildBranchRadii"
    },
    {
      "from": "treeBuilder:buildTree",
      "to": "speedtreeBark:buildSpeedtreeBark"
    },
    {
      "from": "treeBuilder:buildTree",
      "to": "barkSkin:buildBarkSkin"
    },
    {
      "from": "treeBuilder:buildTree",
      "to": "treeBuilder:makeFlowerTemplate"
    },
    {
      "from": "treeBuilder:buildTree",
      "to": "mathUtils:anyPerp"
    },
    {
      "from": "treeBuilder:buildTree",
      "to": "leaf:pushLeafInstance"
    },
    {
      "from": "treeBuilder:buildTree",
      "to": "ambientOcclusion:buildOcclusionGrid"
    },
    {
      "from": "treeBuilder:buildTree",
      "to": "ambientOcclusion:bakeOcclusion"
    },
    {
      "from": "treeBuilder:buildTree",
      "to": "ambientOcclusion:bakeOcclusionByRanges"
    },
    {
      "from": "treeBuilder:buildTree",
      "to": "treeBuilder:finalizeNodes"
    },
    {
      "from": "treeBuilder:buildTree",
      "to": "mathUtils:boxInfo"
    },
    {
      "from": "treeBuilder:makeFlowerTemplate",
      "to": "treeBuilder:mergeFlowerTemplates"
    },
    {
      "from": "treeBuilder:spawnLeaves",
      "to": "mathUtils:lerp"
    },
    {
      "from": "treeBuilder:spawnLeaves",
      "to": "mathUtils:sampleFrame"
    },
    {
      "from": "treeBuilder:spawnLeaves",
      "to": "mathUtils:anyPerp"
    },
    {
      "from": "treeBuilder:spawnLeaves",
      "to": "mathUtils:rotateTowardUp"
    },
    {
      "from": "treeBuilder:spawnLeaves",
      "to": "mathUtils:clamp01"
    },
    {
      "from": "treeBuilder:spawnLeaves",
      "to": "treeBuilder:addSlot"
    },
    {
      "from": "treeBuilder:spawnLeaves",
      "to": "leaf:pushLeafInstance"
    },
    {
      "from": "treeBuilder:spawnChildren",
      "to": "mathUtils:clamp01"
    },
    {
      "from": "treeBuilder:spawnChildren",
      "to": "mathUtils:lerp"
    },
    {
      "from": "treeBuilder:spawnChildren",
      "to": "mathUtils:sampleFrame"
    },
    {
      "from": "treeBuilder:spawnChildren",
      "to": "treeBuilder:childDirection"
    },
    {
      "from": "treeBuilder:spawnChildren",
      "to": "mathUtils:azimuthPerp"
    },
    {
      "from": "treeBuilder:spawnChildren",
      "to": "treeBuilder:frameBasisAt"
    },
    {
      "from": "treeBuilder:spawnChildren",
      "to": "treeBuilder:buildBranch"
    },
    {
      "from": "treeBuilder:applyBranchEdit",
      "to": "treeBuilder:branchEditOf"
    },
    {
      "from": "treeBuilder:buildBranch",
      "to": "mathUtils:growFrames"
    },
    {
      "from": "treeBuilder:buildBranch",
      "to": "treeBuilder:applyBranchEdit"
    },
    {
      "from": "treeBuilder:buildBranch",
      "to": "treeBuilder:sampleGuidePoints"
    },
    {
      "from": "treeBuilder:buildBranch",
      "to": "treeBuilder:addSlot"
    },
    {
      "from": "treeBuilder:buildBranch",
      "to": "barkSkeleton:addBarkBranch"
    },
    {
      "from": "treeBuilder:buildBranch",
      "to": "treeBuilder:spawnChildren"
    },
    {
      "from": "treeBuilder:buildBranch",
      "to": "treeBuilder:spawnLeaves"
    },
    {
      "from": "treeBuilder:buildBranch",
      "to": "treeBuilder:spawnFruit"
    },
    {
      "from": "treeBuilder:trunkRadiusMod",
      "to": "mathUtils:organicRingNoise"
    },
    {
      "from": "treeBuilder:spawnFruit",
      "to": "fruit:buildFruitTemplate"
    },
    {
      "from": "treeBuilder:spawnFruit",
      "to": "mathUtils:sampleFrame"
    },
    {
      "from": "treeBuilder:spawnFruit",
      "to": "mathUtils:azimuthPerp"
    },
    {
      "from": "treeBuilder:spawnFruit",
      "to": "treeBuilder:addSlot"
    },
    {
      "from": "treeBuilder:spawnFruit",
      "to": "fruit:pushFruitInstance"
    },
    {
      "from": "treeBuilder:sampleGuidePoints",
      "to": "mathUtils:sampleFrame"
    },
    {
      "from": "treeBuilder:finalizeNodes",
      "to": "treeBuilder:measure"
    },
    {
      "from": "treeBuilder:finalizeNodes",
      "to": "treeBuilder:unionBox"
    },
    {
      "from": "treeBuilder:measure",
      "to": "treeBuilder:emptyBox"
    },
    {
      "from": "treeBuilder:measure",
      "to": "treeBuilder:unionBox"
    },
    {
      "from": "treeBuilder:estimateScale",
      "to": "treeBuilder:subtree"
    },
    {
      "from": "treeBuilder:estimateScale",
      "to": "treeBuilder:countAt"
    },
    {
      "from": "treeBuilder:subtree",
      "to": "treeBuilder:cnt"
    },
    {
      "from": "treeBuilder:countAt",
      "to": "treeBuilder:cnt"
    },
    {
      "from": "twist:normalizeTwistProfile",
      "to": "twist:defaultTwistProfile"
    },
    {
      "from": "twist:sampleTwistProfile",
      "to": "twist:normalizeTwistProfile"
    },
    {
      "from": "twist:twistProfileRad",
      "to": "twist:sampleTwistProfile"
    },
    {
      "from": "windModel:leafTrajectory",
      "to": "windModel:rotateAroundAxis"
    },
    {
      "from": "windModel:motionMetrics",
      "to": "windModel:leafTrajectory"
    },
    {
      "from": "treeStore:setNodeModel",
      "to": "treeStore:refreshSelectionRanges"
    },
    {
      "from": "treeStore:setNodeModel",
      "to": "treeStore:updateSelectionBox"
    },
    {
      "from": "treeStore:refreshSelectionRanges",
      "to": "treeBuilder:selectionRanges"
    },
    {
      "from": "treeStore:refreshSelectionRanges",
      "to": "treeStore:describeSelection"
    },
    {
      "from": "treeStore:selectNodes",
      "to": "treeStore:refreshSelectionRanges"
    },
    {
      "from": "treeStore:selectNodes",
      "to": "treeStore:updateSelectionBox"
    },
    {
      "from": "treeStore:selectGroup",
      "to": "treeStore:refreshSelectionRanges"
    },
    {
      "from": "treeStore:selectGroup",
      "to": "treeStore:selectNodes"
    },
    {
      "from": "treeStore:openNodePanel",
      "to": "treeStore:selectNodes"
    },
    {
      "from": "treeStore:pushUndo",
      "to": "treeStore:snapshot"
    },
    {
      "from": "treeStore:undo",
      "to": "treeStore:snapshot"
    },
    {
      "from": "treeStore:undo",
      "to": "params:normalizeParams"
    },
    {
      "from": "treeStore:redo",
      "to": "treeStore:snapshot"
    },
    {
      "from": "treeStore:redo",
      "to": "params:normalizeParams"
    },
    {
      "from": "treeStore:randomizeSeed",
      "to": "treeStore:pushUndo"
    },
    {
      "from": "treeStore:randomizeSeed",
      "to": "presets:randomSeed"
    },
    {
      "from": "treeStore:randomizeSeed",
      "to": "treeStore:randomizeFoliageAssets"
    },
    {
      "from": "treeStore:doAutoGenerate",
      "to": "treeStore:pushUndo"
    },
    {
      "from": "treeStore:doAutoGenerate",
      "to": "presets:randomSeed"
    },
    {
      "from": "treeStore:doAutoGenerate",
      "to": "presets:autoGenerate"
    },
    {
      "from": "treeStore:doAutoGenerate",
      "to": "params:cloneParams"
    },
    {
      "from": "treeStore:doAutoGenerate",
      "to": "params:mergeParams"
    },
    {
      "from": "treeStore:doAutoGenerate",
      "to": "params:normalizeParams"
    },
    {
      "from": "treeStore:doApplyPreset",
      "to": "treeStore:pushUndo"
    },
    {
      "from": "treeStore:doApplyPreset",
      "to": "params:normalizeParams"
    },
    {
      "from": "treeStore:applyClassification",
      "to": "treeStore:pushUndo"
    },
    {
      "from": "treeStore:applyClassification",
      "to": "params:normalizeParams"
    },
    {
      "from": "treeStore:applyLeafCard",
      "to": "treeStore:pushUndo"
    },
    {
      "from": "treeStore:fitLeafCardToTexture",
      "to": "treeStore:imageAspect"
    },
    {
      "from": "treeStore:fitLeafCardToTexture",
      "to": "treeStore:pushUndo"
    },
    {
      "from": "treeStore:fitFlowerCardToTexture",
      "to": "treeStore:imageAspect"
    },
    {
      "from": "treeStore:fitFlowerCardToTexture",
      "to": "treeStore:pushUndo"
    },
    {
      "from": "treeStore:randomFlowerCard",
      "to": "treeStore:applyFlowerCard"
    },
    {
      "from": "treeStore:randomizeFoliageAssets",
      "to": "rng:makeRng"
    },
    {
      "from": "treeStore:doGenerateImpostor",
      "to": "treeStore:setImpostorPreview"
    },
    {
      "from": "treeStore:randomLeafCard",
      "to": "treeStore:applyLeafCard"
    },
    {
      "from": "treeStore:randomClassification",
      "to": "treeStore:applyClassification"
    },
    {
      "from": "treeStore:randomizeWind",
      "to": "treeStore:pushUndo"
    },
    {
      "from": "treeStore:resetSection",
      "to": "treeStore:pushUndo"
    },
    {
      "from": "treeStore:importParamsJSON",
      "to": "treeStore:pushUndo"
    },
    {
      "from": "treeStore:importParamsJSON",
      "to": "params:normalizeParams"
    },
    {
      "from": "treeStore:pushFtreeHistory",
      "to": "treeStore:persistFtreeHistory"
    },
    {
      "from": "treeStore:clearFtreeHistory",
      "to": "treeStore:persistFtreeHistory"
    },
    {
      "from": "treeStore:doExportFtree",
      "to": "ftree:exportFtree"
    },
    {
      "from": "treeStore:doExportFtree",
      "to": "treeStore:pushFtreeHistory"
    },
    {
      "from": "treeStore:doImportFtree",
      "to": "ftree:loadFtreeFile"
    },
    {
      "from": "treeStore:doImportFtree",
      "to": "treeStore:pushUndo"
    },
    {
      "from": "treeStore:doImportFtree",
      "to": "treeStore:pushFtreeHistory"
    },
    {
      "from": "treeStore:loadTemplates",
      "to": "templateDb:listTemplates"
    },
    {
      "from": "treeStore:suggestTemplateName",
      "to": "presets:archetypeName"
    }
  ],
  "paramEdges": [
    {
      "group": "lod",
      "key": "barkDetail",
      "to": "barkSkin:buildBarkSkin"
    },
    {
      "group": "seed",
      "key": "*",
      "to": "exporter:buildParamsJSON"
    },
    {
      "group": "fall",
      "key": "*",
      "to": "fallingLeaves:fallRebuildKey"
    },
    {
      "group": "leafMat",
      "key": "*",
      "to": "fallingLeaves:fallRebuildKey"
    },
    {
      "group": "leaves",
      "key": "*",
      "to": "fallingLeaves:fallRebuildKey"
    },
    {
      "group": "fall",
      "key": "*",
      "to": "fallingLeaves:buildFallingLeaves"
    },
    {
      "group": "seed",
      "key": "*",
      "to": "fallingLeaves:buildFallingLeaves"
    },
    {
      "group": "leaves",
      "key": "*",
      "to": "fallingLeaves:buildFallingLeaves"
    },
    {
      "group": "fall",
      "key": "*",
      "to": "fallingLeaves:updateFallingLeaves"
    },
    {
      "group": "fruit",
      "key": "type",
      "to": "forceField:normalizeForceItem"
    },
    {
      "group": "leaves",
      "key": "shape",
      "to": "forceField:normalizeForceItem"
    },
    {
      "group": "leaves",
      "key": "size",
      "to": "forceField:normalizeForceItem"
    },
    {
      "group": "forces",
      "key": "items",
      "to": "forceField:normalizeForces"
    },
    {
      "group": "branches",
      "key": "enabled",
      "to": "forceField:normalizeForces"
    },
    {
      "group": "forces",
      "key": "showHelpers",
      "to": "forceField:normalizeForces"
    },
    {
      "group": "fruit",
      "key": "type",
      "to": "fruit:buildFruitTemplate"
    },
    {
      "group": "fruit",
      "key": "radial",
      "to": "fruit:buildFruitTemplate"
    },
    {
      "group": "leaves",
      "key": "color",
      "to": "fruit:buildFruitTemplate"
    },
    {
      "group": "fruit",
      "key": "capColor",
      "to": "fruit:buildFruitTemplate"
    },
    {
      "group": "bark",
      "key": "scale",
      "to": "fruit:pushFruitInstance"
    },
    {
      "group": "wind",
      "key": "*",
      "to": "fruit:pushFruitInstance"
    },
    {
      "group": "leaves",
      "key": "size",
      "to": "impostor:generateImpostor"
    },
    {
      "group": "leaves",
      "key": "curl",
      "to": "leaf:buildLeafCardTemplate"
    },
    {
      "group": "leaves",
      "key": "fold",
      "to": "leaf:buildLeafCardTemplate"
    },
    {
      "group": "leaves",
      "key": "shape",
      "to": "leaf:buildLeafTemplate"
    },
    {
      "group": "branches",
      "key": "segments",
      "to": "leaf:buildLeafTemplate"
    },
    {
      "group": "leaves",
      "key": "curl",
      "to": "leaf:buildLeafTemplate"
    },
    {
      "group": "leaves",
      "key": "fold",
      "to": "leaf:buildLeafTemplate"
    },
    {
      "group": "leaves",
      "key": "petiole",
      "to": "leaf:buildLeafTemplate"
    },
    {
      "group": "flower",
      "key": "*",
      "to": "leafEffects:resolveLeafEffects"
    },
    {
      "group": "leafMat",
      "key": "*",
      "to": "leafEffects:resolveLeafEffects"
    },
    {
      "group": "flower",
      "key": "cardId",
      "to": "leafTexture:resolveEffectTexture"
    },
    {
      "group": "litter",
      "key": "*",
      "to": "litter:litterRebuildKey"
    },
    {
      "group": "leafMat",
      "key": "*",
      "to": "litter:litterRebuildKey"
    },
    {
      "group": "leaves",
      "key": "*",
      "to": "litter:litterRebuildKey"
    },
    {
      "group": "litter",
      "key": "*",
      "to": "litter:buildLeafLitter"
    },
    {
      "group": "seed",
      "key": "*",
      "to": "litter:buildLeafLitter"
    },
    {
      "group": "leaves",
      "key": "*",
      "to": "litter:buildLeafLitter"
    },
    {
      "group": "flower",
      "key": "normalFromAlbedo",
      "to": "materials:applyAutoNormal"
    },
    {
      "group": "flower",
      "key": "texture",
      "to": "materials:applyAutoNormal"
    },
    {
      "group": "wind",
      "key": "*",
      "to": "materials:perMaterialUniforms"
    },
    {
      "group": "leafMat",
      "key": "*",
      "to": "materials:perMaterialUniforms"
    },
    {
      "group": "bark",
      "key": "*",
      "to": "materials:perMaterialUniforms"
    },
    {
      "group": "flower",
      "key": "translucency",
      "to": "materials:applyTreeShader"
    },
    {
      "group": "bark",
      "key": "*",
      "to": "materials:createBarkMaterial"
    },
    {
      "group": "custom",
      "key": "*",
      "to": "materials:createBarkMaterial"
    },
    {
      "group": "flower",
      "key": "*",
      "to": "materials:flowerLeafParams"
    },
    {
      "group": "leafMat",
      "key": "*",
      "to": "materials:flowerLeafParams"
    },
    {
      "group": "leafMat",
      "key": "*",
      "to": "materials:createLeafMaterial"
    },
    {
      "group": "leafMat",
      "key": "doubleSided",
      "to": "materials:createLeafMaterial"
    },
    {
      "group": "flower",
      "key": "alphaTest",
      "to": "materials:createLeafMaterial"
    },
    {
      "group": "custom",
      "key": "*",
      "to": "materials:createLeafMaterial"
    },
    {
      "group": "bark",
      "key": "*",
      "to": "materials:updateBarkMaterial"
    },
    {
      "group": "wind",
      "key": "*",
      "to": "materials:updateBarkMaterial"
    },
    {
      "group": "bark",
      "key": "uvWarp",
      "to": "materials:updateBarkMaterial"
    },
    {
      "group": "bark",
      "key": "uvWarpScale",
      "to": "materials:updateBarkMaterial"
    },
    {
      "group": "flower",
      "key": "texture",
      "to": "materials:updateBarkMaterial"
    },
    {
      "group": "leaves",
      "key": "color",
      "to": "materials:updateBarkMaterial"
    },
    {
      "group": "bark",
      "key": "color2",
      "to": "materials:updateBarkMaterial"
    },
    {
      "group": "bark",
      "key": "bump",
      "to": "materials:updateBarkMaterial"
    },
    {
      "group": "flower",
      "key": "normalFromAlbedo",
      "to": "materials:updateBarkMaterial"
    },
    {
      "group": "bark",
      "key": "uvScaleU",
      "to": "materials:updateBarkMaterial"
    },
    {
      "group": "bark",
      "key": "uvScaleV",
      "to": "materials:updateBarkMaterial"
    },
    {
      "group": "leafMat",
      "key": "*",
      "to": "materials:updateLeafMaterial"
    },
    {
      "group": "flower",
      "key": "alphaTest",
      "to": "materials:updateLeafMaterial"
    },
    {
      "group": "leafMat",
      "key": "doubleSided",
      "to": "materials:updateLeafMaterial"
    },
    {
      "group": "leafMat",
      "key": "backEnabled",
      "to": "materials:updateLeafMaterial"
    },
    {
      "group": "flower",
      "key": "emissiveColor",
      "to": "materials:updateLeafMaterial"
    },
    {
      "group": "flower",
      "key": "emissive",
      "to": "materials:updateLeafMaterial"
    },
    {
      "group": "flower",
      "key": "texture",
      "to": "materials:updateLeafMaterial"
    },
    {
      "group": "leaves",
      "key": "*",
      "to": "materials:updateLeafMaterial"
    },
    {
      "group": "flower",
      "key": "translucency",
      "to": "materials:updateLeafMaterial"
    },
    {
      "group": "flower",
      "key": "specular",
      "to": "materials:updateLeafMaterial"
    },
    {
      "group": "flower",
      "key": "specularShininess",
      "to": "materials:updateLeafMaterial"
    },
    {
      "group": "flower",
      "key": "specularColor",
      "to": "materials:updateLeafMaterial"
    },
    {
      "group": "flower",
      "key": "scatter",
      "to": "materials:updateLeafMaterial"
    },
    {
      "group": "flower",
      "key": "scatterPower",
      "to": "materials:updateLeafMaterial"
    },
    {
      "group": "wind",
      "key": "*",
      "to": "materials:updateLeafMaterial"
    },
    {
      "group": "leafMat",
      "key": "backColor",
      "to": "materials:updateLeafMaterial"
    },
    {
      "group": "leafMat",
      "key": "backTexture",
      "to": "materials:updateLeafMaterial"
    },
    {
      "group": "flower",
      "key": "textureU",
      "to": "materials:updateLeafMaterial"
    },
    {
      "group": "flower",
      "key": "textureV",
      "to": "materials:updateLeafMaterial"
    },
    {
      "group": "flower",
      "key": "textureRepeat",
      "to": "materials:updateLeafMaterial"
    },
    {
      "group": "flower",
      "key": "textureRepeatU",
      "to": "materials:updateLeafMaterial"
    },
    {
      "group": "flower",
      "key": "textureRepeatV",
      "to": "materials:updateLeafMaterial"
    },
    {
      "group": "flower",
      "key": "textureRotation",
      "to": "materials:updateLeafMaterial"
    },
    {
      "group": "wind",
      "key": "*",
      "to": "materials:updateMaterials"
    },
    {
      "group": "seed",
      "key": "*",
      "to": "materials:updateMaterials"
    },
    {
      "group": "custom",
      "key": "*",
      "to": "materials:rebindCustomShader"
    },
    {
      "group": "branches",
      "key": "segments",
      "to": "mathUtils:growFrames"
    },
    {
      "group": "roots",
      "key": "length",
      "to": "mathUtils:growFrames"
    },
    {
      "group": "branches",
      "key": "curve",
      "to": "mathUtils:growFrames"
    },
    {
      "group": "branches",
      "key": "curveVariance",
      "to": "mathUtils:growFrames"
    },
    {
      "group": "branches",
      "key": "gravity",
      "to": "mathUtils:growFrames"
    },
    {
      "group": "trunk",
      "key": "gnarl",
      "to": "mathUtils:growFrames"
    },
    {
      "group": "branches",
      "key": "twist",
      "to": "mathUtils:growFrames"
    },
    {
      "group": "branches",
      "key": "twistProfile",
      "to": "mathUtils:growFrames"
    },
    {
      "group": "branches",
      "key": "radiusCurve",
      "to": "mathUtils:growFrames"
    },
    {
      "group": "branches",
      "key": "nodeRoll",
      "to": "mathUtils:growFrames"
    },
    {
      "group": "branches",
      "key": "nodeOffset",
      "to": "mathUtils:growFrames"
    },
    {
      "group": "branches",
      "key": "nodeJumble",
      "to": "mathUtils:growFrames"
    },
    {
      "group": "branches",
      "key": "nodeRollBias",
      "to": "mathUtils:growFrames"
    },
    {
      "group": "branches",
      "key": "nodeJumbleBias",
      "to": "mathUtils:growFrames"
    },
    {
      "group": "branches",
      "key": "spineNoise",
      "to": "mathUtils:growFrames"
    },
    {
      "group": "fall",
      "key": "*",
      "to": "params:ensureFeatureDefaults"
    },
    {
      "group": "litter",
      "key": "*",
      "to": "params:ensureFeatureDefaults"
    },
    {
      "group": "flowerFall",
      "key": "*",
      "to": "params:ensureFeatureDefaults"
    },
    {
      "group": "flowerLitter",
      "key": "*",
      "to": "params:ensureFeatureDefaults"
    },
    {
      "group": "leaves",
      "key": "*",
      "to": "params:ensureFeatureDefaults"
    },
    {
      "group": "flower",
      "key": "*",
      "to": "params:ensureFeatureDefaults"
    },
    {
      "group": "particles",
      "key": "*",
      "to": "particles:sampleEmitPositions"
    },
    {
      "group": "branches",
      "key": "count",
      "to": "particles:sampleEmitPositions"
    },
    {
      "group": "branches",
      "key": "spread",
      "to": "particles:sampleEmitPositions"
    },
    {
      "group": "particles",
      "key": "*",
      "to": "particles:createParticleMaterial"
    },
    {
      "group": "leaves",
      "key": "size",
      "to": "particles:createParticleMaterial"
    },
    {
      "group": "fall",
      "key": "*",
      "to": "particles:createParticleMaterial"
    },
    {
      "group": "particles",
      "key": "sway",
      "to": "particles:createParticleMaterial"
    },
    {
      "group": "particles",
      "key": "glow",
      "to": "particles:createParticleMaterial"
    },
    {
      "group": "leaves",
      "key": "color",
      "to": "particles:createParticleMaterial"
    },
    {
      "group": "particles",
      "key": "*",
      "to": "particles:updateParticleMaterial"
    },
    {
      "group": "leaves",
      "key": "size",
      "to": "particles:updateParticleMaterial"
    },
    {
      "group": "fall",
      "key": "*",
      "to": "particles:updateParticleMaterial"
    },
    {
      "group": "particles",
      "key": "sway",
      "to": "particles:updateParticleMaterial"
    },
    {
      "group": "particles",
      "key": "glow",
      "to": "particles:updateParticleMaterial"
    },
    {
      "group": "leaves",
      "key": "color",
      "to": "particles:updateParticleMaterial"
    },
    {
      "group": "particles",
      "key": "*",
      "to": "particles:buildParticlePoints"
    },
    {
      "group": "branches",
      "key": "enabled",
      "to": "particles:buildParticlePoints"
    },
    {
      "group": "seed",
      "key": "*",
      "to": "presets:applyPreset"
    },
    {
      "group": "wind",
      "key": "*",
      "to": "presets:applyPreset"
    },
    {
      "group": "trunk",
      "key": "*",
      "to": "presets:autoGenerate"
    },
    {
      "group": "branches",
      "key": "*",
      "to": "presets:autoGenerate"
    },
    {
      "group": "leaves",
      "key": "*",
      "to": "presets:autoGenerate"
    },
    {
      "group": "wind",
      "key": "*",
      "to": "presets:autoGenerate"
    },
    {
      "group": "auto",
      "key": "*",
      "to": "presets:autoGenerate"
    },
    {
      "group": "classify",
      "key": "*",
      "to": "presets:autoGenerate"
    },
    {
      "group": "seed",
      "key": "*",
      "to": "presets:autoGenerate"
    },
    {
      "group": "branches",
      "key": "count",
      "to": "presets:autoGenerate"
    },
    {
      "group": "branches",
      "key": "pitch",
      "to": "presets:autoGenerate"
    },
    {
      "group": "branches",
      "key": "pitchVariance",
      "to": "presets:autoGenerate"
    },
    {
      "group": "branches",
      "key": "lengthRatio",
      "to": "presets:autoGenerate"
    },
    {
      "group": "branches",
      "key": "lengthVariance",
      "to": "presets:autoGenerate"
    },
    {
      "group": "branches",
      "key": "radiusRatio",
      "to": "presets:autoGenerate"
    },
    {
      "group": "branches",
      "key": "curve",
      "to": "presets:autoGenerate"
    },
    {
      "group": "branches",
      "key": "gravity",
      "to": "presets:autoGenerate"
    },
    {
      "group": "branches",
      "key": "twist",
      "to": "presets:autoGenerate"
    },
    {
      "group": "branches",
      "key": "phyllotaxis",
      "to": "presets:autoGenerate"
    },
    {
      "group": "branches",
      "key": "spread",
      "to": "presets:autoGenerate"
    },
    {
      "group": "wind",
      "key": "*",
      "to": "sceneManager:updateWind"
    },
    {
      "group": "forces",
      "key": "*",
      "to": "sceneManager:build"
    },
    {
      "group": "scene",
      "key": "*",
      "to": "sceneManager:build"
    },
    {
      "group": "branchEdits",
      "key": "*",
      "to": "sceneManager:_syncBranchGizmo"
    },
    {
      "group": "lod",
      "key": "*",
      "to": "sceneManager:_ensureLod"
    },
    {
      "group": "lod",
      "key": "keep1",
      "to": "sceneManager:_ensureLod"
    },
    {
      "group": "lod",
      "key": "keep2",
      "to": "sceneManager:_ensureLod"
    },
    {
      "group": "lod",
      "key": "*",
      "to": "sceneManager:updateLod"
    },
    {
      "group": "lod",
      "key": "force",
      "to": "sceneManager:updateLod"
    },
    {
      "group": "lod",
      "key": "dynamic",
      "to": "sceneManager:updateLod"
    },
    {
      "group": "lod",
      "key": "distance1",
      "to": "sceneManager:updateLod"
    },
    {
      "group": "lod",
      "key": "distance2",
      "to": "sceneManager:updateLod"
    },
    {
      "group": "particles",
      "key": "*",
      "to": "sceneManager:rebuildParticles"
    },
    {
      "group": "branches",
      "key": "enabled",
      "to": "sceneManager:rebuildParticles"
    },
    {
      "group": "seed",
      "key": "*",
      "to": "sceneManager:rebuildParticles"
    },
    {
      "group": "particles",
      "key": "*",
      "to": "sceneManager:updateParticles"
    },
    {
      "group": "branches",
      "key": "enabled",
      "to": "sceneManager:updateParticles"
    },
    {
      "group": "branches",
      "key": "count",
      "to": "sceneManager:updateParticles"
    },
    {
      "group": "fall",
      "key": "*",
      "to": "sceneManager:rebuildFall"
    },
    {
      "group": "leafMat",
      "key": "*",
      "to": "sceneManager:rebuildFall"
    },
    {
      "group": "fall",
      "key": "*",
      "to": "sceneManager:updateFall"
    },
    {
      "group": "flowerFall",
      "key": "*",
      "to": "sceneManager:_flowerFallParams"
    },
    {
      "group": "flower",
      "key": "*",
      "to": "sceneManager:_flowerFallParams"
    },
    {
      "group": "fall",
      "key": "*",
      "to": "sceneManager:_flowerFallParams"
    },
    {
      "group": "leafMat",
      "key": "*",
      "to": "sceneManager:_flowerFallParams"
    },
    {
      "group": "flowerLitter",
      "key": "*",
      "to": "sceneManager:_flowerLitterParams"
    },
    {
      "group": "flower",
      "key": "*",
      "to": "sceneManager:_flowerLitterParams"
    },
    {
      "group": "litter",
      "key": "*",
      "to": "sceneManager:_flowerLitterParams"
    },
    {
      "group": "leafMat",
      "key": "*",
      "to": "sceneManager:_flowerLitterParams"
    },
    {
      "group": "flowerFall",
      "key": "*",
      "to": "sceneManager:rebuildFlowerFall"
    },
    {
      "group": "flowerFall",
      "key": "*",
      "to": "sceneManager:updateFlowerFall"
    },
    {
      "group": "flowerLitter",
      "key": "*",
      "to": "sceneManager:rebuildFlowerLitter"
    },
    {
      "group": "flowerLitter",
      "key": "*",
      "to": "sceneManager:updateFlowerLitter"
    },
    {
      "group": "litter",
      "key": "*",
      "to": "sceneManager:rebuildLitter"
    },
    {
      "group": "leafMat",
      "key": "*",
      "to": "sceneManager:rebuildLitter"
    },
    {
      "group": "litter",
      "key": "*",
      "to": "sceneManager:updateLitter"
    },
    {
      "group": "fruit",
      "key": "*",
      "to": "sceneManager:_getFruitExportMaterial"
    },
    {
      "group": "seed",
      "key": "*",
      "to": "sceneManager:_getFruitExportMaterial"
    },
    {
      "group": "exportOptions",
      "key": "*",
      "to": "sceneManager:buildExportGroup"
    },
    {
      "group": "trunk",
      "key": "*",
      "to": "sceneManager:buildExportGroup"
    },
    {
      "group": "exportOptions",
      "key": "mergeBark",
      "to": "sceneManager:buildExportGroup"
    },
    {
      "group": "trunk",
      "key": "*",
      "to": "species:applyVariation"
    },
    {
      "group": "branches",
      "key": "*",
      "to": "species:applyVariation"
    },
    {
      "group": "leaves",
      "key": "*",
      "to": "species:applyVariation"
    },
    {
      "group": "branches",
      "key": "count",
      "to": "species:applyVariation"
    },
    {
      "group": "branches",
      "key": "pitch",
      "to": "species:applyVariation"
    },
    {
      "group": "branches",
      "key": "pitchVariance",
      "to": "species:applyVariation"
    },
    {
      "group": "branches",
      "key": "lengthRatio",
      "to": "species:applyVariation"
    },
    {
      "group": "branches",
      "key": "lengthVariance",
      "to": "species:applyVariation"
    },
    {
      "group": "branches",
      "key": "radiusRatio",
      "to": "species:applyVariation"
    },
    {
      "group": "branches",
      "key": "curve",
      "to": "species:applyVariation"
    },
    {
      "group": "branches",
      "key": "gravity",
      "to": "species:applyVariation"
    },
    {
      "group": "branches",
      "key": "upBias",
      "to": "species:applyVariation"
    },
    {
      "group": "branches",
      "key": "segments",
      "to": "species:applyVariation"
    },
    {
      "group": "trunk",
      "key": "*",
      "to": "species:applyStage"
    },
    {
      "group": "roots",
      "key": "*",
      "to": "species:applyStage"
    },
    {
      "group": "branches",
      "key": "*",
      "to": "species:applyStage"
    },
    {
      "group": "leaves",
      "key": "*",
      "to": "species:applyStage"
    },
    {
      "group": "leaves",
      "key": "*",
      "to": "species:applySeason"
    },
    {
      "group": "bark",
      "key": "*",
      "to": "species:applySeason"
    },
    {
      "group": "leafMat",
      "key": "*",
      "to": "species:applySeason"
    },
    {
      "group": "leaves",
      "key": "*",
      "to": "species:composeTree"
    },
    {
      "group": "classify",
      "key": "*",
      "to": "species:composeTree"
    },
    {
      "group": "seed",
      "key": "*",
      "to": "species:composeTree"
    },
    {
      "group": "auto",
      "key": "*",
      "to": "species:composeTree"
    },
    {
      "group": "wind",
      "key": "*",
      "to": "species:composeTree"
    },
    {
      "group": "branches",
      "key": "*",
      "to": "species:composeTree"
    },
    {
      "group": "auto",
      "key": "chaos",
      "to": "species:composeTree"
    },
    {
      "group": "lod",
      "key": "barkDetail",
      "to": "speedtreeBark:buildSpeedtreeBark"
    },
    {
      "group": "leaves",
      "key": "size",
      "to": "textures:makeBarkTextures"
    },
    {
      "group": "bark",
      "key": "style",
      "to": "textures:makeBarkTextures"
    },
    {
      "group": "bark",
      "key": "scale",
      "to": "textures:makeBarkTextures"
    },
    {
      "group": "bark",
      "key": "contrast",
      "to": "textures:makeBarkTextures"
    },
    {
      "group": "seed",
      "key": "*",
      "to": "textures:makeBarkTextures"
    },
    {
      "group": "leaves",
      "key": "color",
      "to": "textures:makeBarkTextures"
    },
    {
      "group": "bark",
      "key": "color2",
      "to": "textures:makeBarkTextures"
    },
    {
      "group": "bark",
      "key": "bump",
      "to": "textures:makeBarkTextures"
    },
    {
      "group": "leaves",
      "key": "size",
      "to": "textures:makeLeafTexture"
    },
    {
      "group": "leaves",
      "key": "shape",
      "to": "textures:makeLeafTexture"
    },
    {
      "group": "seed",
      "key": "*",
      "to": "textures:makeLeafTexture"
    },
    {
      "group": "branches",
      "key": "*",
      "to": "treeBuilder:childDirection"
    },
    {
      "group": "branches",
      "key": "phyllotaxis",
      "to": "treeBuilder:childDirection"
    },
    {
      "group": "branches",
      "key": "spread",
      "to": "treeBuilder:childDirection"
    },
    {
      "group": "branches",
      "key": "pitch",
      "to": "treeBuilder:childDirection"
    },
    {
      "group": "branches",
      "key": "pitchVariance",
      "to": "treeBuilder:childDirection"
    },
    {
      "group": "branches",
      "key": "gravity",
      "to": "treeBuilder:childDirection"
    },
    {
      "group": "branches",
      "key": "upBias",
      "to": "treeBuilder:childDirection"
    },
    {
      "group": "forces",
      "key": "*",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "branches",
      "key": "*",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "trunk",
      "key": "*",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "leaves",
      "key": "*",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "fruit",
      "key": "*",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "flower",
      "key": "*",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "lod",
      "key": "*",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "seed",
      "key": "*",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "branchEdits",
      "key": "*",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "roots",
      "key": "*",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "bark",
      "key": "*",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "ao",
      "key": "*",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "trunk",
      "key": "lean",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "trunk",
      "key": "leanDirection",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "trunk",
      "key": "knotStrength",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "trunk",
      "key": "knotSpread",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "trunk",
      "key": "knotAngle",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "trunk",
      "key": "knotNoise",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "trunk",
      "key": "knots",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "trunk",
      "key": "knotSize",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "trunk",
      "key": "baseRadius",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "trunk",
      "key": "taper",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "trunk",
      "key": "height",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "trunk",
      "key": "radiusCurve",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "trunk",
      "key": "segments",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "trunk",
      "key": "curve",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "trunk",
      "key": "curveVariance",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "trunk",
      "key": "twist",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "trunk",
      "key": "twistProfile",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "trunk",
      "key": "gnarl",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "trunk",
      "key": "spineNoise",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "trunk",
      "key": "squash",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "trunk",
      "key": "radialSegments",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "trunk",
      "key": "crossNoise",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "leaves",
      "key": "cardMode",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "leaves",
      "key": "cardAspect",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "leaves",
      "key": "cardCurl",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "leaves",
      "key": "cardFold",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "leaves",
      "key": "segments",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "leaves",
      "key": "curl",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "leaves",
      "key": "fold",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "leaves",
      "key": "petiole",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "leaves",
      "key": "shape",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "leaves",
      "key": "color",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "leaves",
      "key": "colorTip",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "leaves",
      "key": "enabled",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "flower",
      "key": "enabled",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "flower",
      "key": "useShape",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "flower",
      "key": "shape",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "flower",
      "key": "segments",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "flower",
      "key": "curl",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "flower",
      "key": "fold",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "flower",
      "key": "petiole",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "flower",
      "key": "cardAspect",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "flower",
      "key": "cardCurl",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "flower",
      "key": "cardFold",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "flower",
      "key": "size",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "flower",
      "key": "width",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "flower",
      "key": "sizeVariance",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "flower",
      "key": "color",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "flower",
      "key": "colorTip",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "flower",
      "key": "levels",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "flower",
      "key": "perBranch",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "flower",
      "key": "clusterCount",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "flower",
      "key": "startT",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "flower",
      "key": "endT",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "flower",
      "key": "density",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "flower",
      "key": "clusterRadius",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "flower",
      "key": "clusterSpread",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "flower",
      "key": "pitch",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "flower",
      "key": "pitchVariance",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "flower",
      "key": "rollVariance",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "flower",
      "key": "droop",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "flower",
      "key": "branchWrap",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "flower",
      "key": "branchWrapTurns",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "flower",
      "key": "colorVariance",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "flower",
      "key": "faceUp",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "flower",
      "key": "twist",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "flower",
      "key": "modelRotation",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "roots",
      "key": "enabled",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "roots",
      "key": "count",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "roots",
      "key": "heightOffset",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "roots",
      "key": "autoStagger",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "roots",
      "key": "spread",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "roots",
      "key": "pitch",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "roots",
      "key": "length",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "roots",
      "key": "lengthVariance",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "roots",
      "key": "radiusRatio",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "roots",
      "key": "segments",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "roots",
      "key": "curve",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "roots",
      "key": "sink",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "roots",
      "key": "radialSegments",
      "to": "treeBuilder:buildTree"
    },
    {
      "group": "branches",
      "key": "*",
      "to": "treeBuilder:effFruitLevels"
    },
    {
      "group": "fruit",
      "key": "levels",
      "to": "treeBuilder:effFruitLevels"
    },
    {
      "group": "flower",
      "key": "cross",
      "to": "treeBuilder:makeFlowerTemplate"
    },
    {
      "group": "leaves",
      "key": "enabled",
      "to": "treeBuilder:spawnLeaves"
    },
    {
      "group": "leaves",
      "key": "perBranch",
      "to": "treeBuilder:spawnLeaves"
    },
    {
      "group": "leaves",
      "key": "clusterCount",
      "to": "treeBuilder:spawnLeaves"
    },
    {
      "group": "leaves",
      "key": "startT",
      "to": "treeBuilder:spawnLeaves"
    },
    {
      "group": "leaves",
      "key": "endT",
      "to": "treeBuilder:spawnLeaves"
    },
    {
      "group": "leaves",
      "key": "branchWrap",
      "to": "treeBuilder:spawnLeaves"
    },
    {
      "group": "leaves",
      "key": "branchWrapTurns",
      "to": "treeBuilder:spawnLeaves"
    },
    {
      "group": "leaves",
      "key": "clusterRadius",
      "to": "treeBuilder:spawnLeaves"
    },
    {
      "group": "leaves",
      "key": "clusterSpread",
      "to": "treeBuilder:spawnLeaves"
    },
    {
      "group": "leaves",
      "key": "pitch",
      "to": "treeBuilder:spawnLeaves"
    },
    {
      "group": "leaves",
      "key": "pitchVariance",
      "to": "treeBuilder:spawnLeaves"
    },
    {
      "group": "leaves",
      "key": "droop",
      "to": "treeBuilder:spawnLeaves"
    },
    {
      "group": "leaves",
      "key": "twist",
      "to": "treeBuilder:spawnLeaves"
    },
    {
      "group": "leaves",
      "key": "rollVariance",
      "to": "treeBuilder:spawnLeaves"
    },
    {
      "group": "leaves",
      "key": "faceUp",
      "to": "treeBuilder:spawnLeaves"
    },
    {
      "group": "leaves",
      "key": "modelRotation",
      "to": "treeBuilder:spawnLeaves"
    },
    {
      "group": "leaves",
      "key": "size",
      "to": "treeBuilder:spawnLeaves"
    },
    {
      "group": "leaves",
      "key": "sizeVariance",
      "to": "treeBuilder:spawnLeaves"
    },
    {
      "group": "leaves",
      "key": "cardMode",
      "to": "treeBuilder:spawnLeaves"
    },
    {
      "group": "leaves",
      "key": "cardAspect",
      "to": "treeBuilder:spawnLeaves"
    },
    {
      "group": "leaves",
      "key": "width",
      "to": "treeBuilder:spawnLeaves"
    },
    {
      "group": "leaves",
      "key": "colorVariance",
      "to": "treeBuilder:spawnLeaves"
    },
    {
      "group": "flower",
      "key": "enabled",
      "to": "treeBuilder:spawnLeaves"
    },
    {
      "group": "branches",
      "key": "enabled",
      "to": "treeBuilder:spawnChildren"
    },
    {
      "group": "branches",
      "key": "count",
      "to": "treeBuilder:spawnChildren"
    },
    {
      "group": "branches",
      "key": "startT",
      "to": "treeBuilder:spawnChildren"
    },
    {
      "group": "branches",
      "key": "endT",
      "to": "treeBuilder:spawnChildren"
    },
    {
      "group": "branches",
      "key": "startJitter",
      "to": "treeBuilder:spawnChildren"
    },
    {
      "group": "branches",
      "key": "lengthRatio",
      "to": "treeBuilder:spawnChildren"
    },
    {
      "group": "branches",
      "key": "lengthVariance",
      "to": "treeBuilder:spawnChildren"
    },
    {
      "group": "branches",
      "key": "radiusRatio",
      "to": "treeBuilder:spawnChildren"
    },
    {
      "group": "branches",
      "key": "radiusVariance",
      "to": "treeBuilder:spawnChildren"
    },
    {
      "group": "branches",
      "key": "taper",
      "to": "treeBuilder:spawnChildren"
    },
    {
      "group": "branches",
      "key": "phyllotaxis",
      "to": "treeBuilder:spawnChildren"
    },
    {
      "group": "branches",
      "key": "windGain",
      "to": "treeBuilder:spawnChildren"
    },
    {
      "group": "branches",
      "key": "*",
      "to": "treeBuilder:buildBranch"
    },
    {
      "group": "lod",
      "key": "*",
      "to": "treeBuilder:buildBranch"
    },
    {
      "group": "leaves",
      "key": "enabled",
      "to": "treeBuilder:buildBranch"
    },
    {
      "group": "leaves",
      "key": "levels",
      "to": "treeBuilder:buildBranch"
    },
    {
      "group": "fruit",
      "key": "enabled",
      "to": "treeBuilder:buildBranch"
    },
    {
      "group": "flower",
      "key": "enabled",
      "to": "treeBuilder:buildBranch"
    },
    {
      "group": "branches",
      "key": "radiusCurve",
      "to": "treeBuilder:buildBranch"
    },
    {
      "group": "branches",
      "key": "segments",
      "to": "treeBuilder:buildBranch"
    },
    {
      "group": "branches",
      "key": "curve",
      "to": "treeBuilder:buildBranch"
    },
    {
      "group": "branches",
      "key": "curveVariance",
      "to": "treeBuilder:buildBranch"
    },
    {
      "group": "branches",
      "key": "gravity",
      "to": "treeBuilder:buildBranch"
    },
    {
      "group": "branches",
      "key": "upBias",
      "to": "treeBuilder:buildBranch"
    },
    {
      "group": "branches",
      "key": "twist",
      "to": "treeBuilder:buildBranch"
    },
    {
      "group": "branches",
      "key": "twistProfile",
      "to": "treeBuilder:buildBranch"
    },
    {
      "group": "branches",
      "key": "taper",
      "to": "treeBuilder:buildBranch"
    },
    {
      "group": "branches",
      "key": "nodeRoll",
      "to": "treeBuilder:buildBranch"
    },
    {
      "group": "branches",
      "key": "nodeOffset",
      "to": "treeBuilder:buildBranch"
    },
    {
      "group": "branches",
      "key": "nodeJumble",
      "to": "treeBuilder:buildBranch"
    },
    {
      "group": "branches",
      "key": "nodeRollBias",
      "to": "treeBuilder:buildBranch"
    },
    {
      "group": "branches",
      "key": "nodeJumbleBias",
      "to": "treeBuilder:buildBranch"
    },
    {
      "group": "branches",
      "key": "spineNoise",
      "to": "treeBuilder:buildBranch"
    },
    {
      "group": "branches",
      "key": "radialSegments",
      "to": "treeBuilder:buildBranch"
    },
    {
      "group": "branches",
      "key": "crossSection",
      "to": "treeBuilder:buildBranch"
    },
    {
      "group": "branches",
      "key": "starDepth",
      "to": "treeBuilder:buildBranch"
    },
    {
      "group": "branches",
      "key": "crossNoise",
      "to": "treeBuilder:buildBranch"
    },
    {
      "group": "trunk",
      "key": "flare",
      "to": "treeBuilder:trunkRadiusMod"
    },
    {
      "group": "trunk",
      "key": "flareHeight",
      "to": "treeBuilder:trunkRadiusMod"
    },
    {
      "group": "trunk",
      "key": "spread",
      "to": "treeBuilder:trunkRadiusMod"
    },
    {
      "group": "trunk",
      "key": "angle",
      "to": "treeBuilder:trunkRadiusMod"
    },
    {
      "group": "fruit",
      "key": "perBranch",
      "to": "treeBuilder:spawnFruit"
    },
    {
      "group": "fruit",
      "key": "clusterCount",
      "to": "treeBuilder:spawnFruit"
    },
    {
      "group": "fruit",
      "key": "type",
      "to": "treeBuilder:spawnFruit"
    },
    {
      "group": "fruit",
      "key": "color",
      "to": "treeBuilder:spawnFruit"
    },
    {
      "group": "fruit",
      "key": "capColor",
      "to": "treeBuilder:spawnFruit"
    },
    {
      "group": "fruit",
      "key": "radial",
      "to": "treeBuilder:spawnFruit"
    },
    {
      "group": "fruit",
      "key": "clusterRadius",
      "to": "treeBuilder:spawnFruit"
    },
    {
      "group": "fruit",
      "key": "size",
      "to": "treeBuilder:spawnFruit"
    },
    {
      "group": "fruit",
      "key": "sizeVariance",
      "to": "treeBuilder:spawnFruit"
    },
    {
      "group": "fruit",
      "key": "droop",
      "to": "treeBuilder:spawnFruit"
    },
    {
      "group": "fruit",
      "key": "maxCount",
      "to": "treeBuilder:spawnFruit"
    },
    {
      "group": "fruit",
      "key": "chance",
      "to": "treeBuilder:spawnFruit"
    },
    {
      "group": "fruit",
      "key": "colorVariance",
      "to": "treeBuilder:spawnFruit"
    },
    {
      "group": "branches",
      "key": "*",
      "to": "treeBuilder:estimateScale"
    },
    {
      "group": "trunk",
      "key": "*",
      "to": "treeBuilder:estimateScale"
    },
    {
      "group": "leaves",
      "key": "*",
      "to": "treeBuilder:estimateScale"
    },
    {
      "group": "branches",
      "key": "*",
      "to": "treeBuilder:cnt"
    },
    {
      "group": "branches",
      "key": "enabled",
      "to": "treeBuilder:cnt"
    },
    {
      "group": "branches",
      "key": "count",
      "to": "treeBuilder:cnt"
    },
    {
      "group": "seed",
      "key": "*",
      "to": "treeStore:setSeed"
    },
    {
      "group": "branchEdits",
      "key": "*",
      "to": "treeStore:setSeed"
    },
    {
      "group": "seed",
      "key": "*",
      "to": "treeStore:randomizeSeed"
    },
    {
      "group": "branchEdits",
      "key": "*",
      "to": "treeStore:randomizeSeed"
    },
    {
      "group": "wind",
      "key": "*",
      "to": "treeStore:randomizeSeed"
    },
    {
      "group": "branchEdits",
      "key": "*",
      "to": "treeStore:doAutoGenerate"
    },
    {
      "group": "auto",
      "key": "*",
      "to": "treeStore:doAutoGenerate"
    },
    {
      "group": "scene",
      "key": "*",
      "to": "treeStore:doAutoGenerate"
    },
    {
      "group": "custom",
      "key": "*",
      "to": "treeStore:doAutoGenerate"
    },
    {
      "group": "bark",
      "key": "*",
      "to": "treeStore:doAutoGenerate"
    },
    {
      "group": "leafMat",
      "key": "*",
      "to": "treeStore:doAutoGenerate"
    },
    {
      "group": "growth",
      "key": "*",
      "to": "treeStore:doAutoGenerate"
    },
    {
      "group": "lod",
      "key": "*",
      "to": "treeStore:doAutoGenerate"
    },
    {
      "group": "seed",
      "key": "*",
      "to": "treeStore:doAutoGenerate"
    },
    {
      "group": "auto",
      "key": "chaos",
      "to": "treeStore:doAutoGenerate"
    },
    {
      "group": "fruit",
      "key": "type",
      "to": "treeStore:doAutoGenerate"
    },
    {
      "group": "bark",
      "key": "*",
      "to": "treeStore:pickBarkOverrides"
    },
    {
      "group": "branchEdits",
      "key": "*",
      "to": "treeStore:doApplyPreset"
    },
    {
      "group": "wind",
      "key": "*",
      "to": "treeStore:doApplyPreset"
    },
    {
      "group": "seed",
      "key": "*",
      "to": "treeStore:doApplyPreset"
    },
    {
      "group": "wind",
      "key": "*",
      "to": "treeStore:applyClassification"
    },
    {
      "group": "seed",
      "key": "*",
      "to": "treeStore:applyClassification"
    },
    {
      "group": "classify",
      "key": "*",
      "to": "treeStore:applyClassification"
    },
    {
      "group": "leaves",
      "key": "*",
      "to": "treeStore:applyLeafCard"
    },
    {
      "group": "leafMat",
      "key": "*",
      "to": "treeStore:applyLeafCard"
    },
    {
      "group": "flower",
      "key": "alphaTest",
      "to": "treeStore:applyLeafCard"
    },
    {
      "group": "leafMat",
      "key": "*",
      "to": "treeStore:fitLeafCardToTexture"
    },
    {
      "group": "leaves",
      "key": "*",
      "to": "treeStore:fitLeafCardToTexture"
    },
    {
      "group": "flower",
      "key": "*",
      "to": "treeStore:fitFlowerCardToTexture"
    },
    {
      "group": "flower",
      "key": "*",
      "to": "treeStore:applyFlowerCard"
    },
    {
      "group": "leaves",
      "key": "*",
      "to": "treeStore:randomizeFoliageAssets"
    },
    {
      "group": "leafMat",
      "key": "*",
      "to": "treeStore:randomizeFoliageAssets"
    },
    {
      "group": "flower",
      "key": "*",
      "to": "treeStore:randomizeFoliageAssets"
    },
    {
      "group": "wind",
      "key": "*",
      "to": "treeStore:setWindIntensity"
    },
    {
      "group": "seed",
      "key": "*",
      "to": "treeStore:setWindIntensity"
    },
    {
      "group": "wind",
      "key": "*",
      "to": "treeStore:randomizeWind"
    },
    {
      "group": "wind",
      "key": "*",
      "to": "treeStore:setWindAuto"
    },
    {
      "group": "seed",
      "key": "*",
      "to": "treeStore:setWindAuto"
    },
    {
      "group": "branches",
      "key": "*",
      "to": "treeStore:resetSection"
    },
    {
      "group": "seed",
      "key": "*",
      "to": "treeStore:doExportFtree"
    },
    {
      "group": "classify",
      "key": "*",
      "to": "treeStore:suggestTemplateName"
    }
  ]
}
