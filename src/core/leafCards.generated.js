/**
 * 内置叶片卡片库 (由 public/leaves 自动生成, 请勿手改)
 * ------------------------------------------------------------
 * 来源: 用户提供的 leaves_v2_batch1 / leaves_v2_batch2
 * 预处理: 按 alpha 包围盒裁掉透明边 -> 贴图边界 = 叶片轮廓;
 *         aspect = 裁剪后 宽/高, 卡片几何直接用它即可得到一致的叶形。
 * 结构: batch1 (秋色系) 7 种叶形 + batch2 (绿色系) 6 种叶形, 每种若干颜色变体
 */
export const LEAF_CARD_BATCHES = {
  "batch1": {
    "1": 6,
    "2": 6,
    "3": 6,
    "4": 6,
    "5": 7,
    "6": 7,
    "7": 6
  },
  "batch2": {
    "1": 9,
    "2": 9,
    "3": 9,
    "4": 9,
    "5": 9,
    "6": 8
  }
}

export const LEAF_CARDS = [
  {
    "id": "batch1-r01-c01",
    "batch": "batch1",
    "row": 1,
    "col": 1,
    "url": "/leaves/batch1/v2_leaf1_r01_c01.png",
    "aspect": 1.005,
    "w": 216,
    "h": 215
  },
  {
    "id": "batch1-r01-c02",
    "batch": "batch1",
    "row": 1,
    "col": 2,
    "url": "/leaves/batch1/v2_leaf1_r01_c02.png",
    "aspect": 1.009,
    "w": 218,
    "h": 216
  },
  {
    "id": "batch1-r01-c03",
    "batch": "batch1",
    "row": 1,
    "col": 3,
    "url": "/leaves/batch1/v2_leaf1_r01_c03.png",
    "aspect": 1,
    "w": 216,
    "h": 216
  },
  {
    "id": "batch1-r01-c04",
    "batch": "batch1",
    "row": 1,
    "col": 4,
    "url": "/leaves/batch1/v2_leaf1_r01_c04.png",
    "aspect": 0.963,
    "w": 208,
    "h": 216
  },
  {
    "id": "batch1-r01-c06",
    "batch": "batch1",
    "row": 1,
    "col": 6,
    "url": "/leaves/batch1/v2_leaf1_r01_c06.png",
    "aspect": 0.981,
    "w": 211,
    "h": 215
  },
  {
    "id": "batch1-r01-c10",
    "batch": "batch1",
    "row": 1,
    "col": 10,
    "url": "/leaves/batch1/v2_leaf1_r01_c10.png",
    "aspect": 0.963,
    "w": 206,
    "h": 214
  },
  {
    "id": "batch1-r02-c01",
    "batch": "batch1",
    "row": 2,
    "col": 1,
    "url": "/leaves/batch1/v2_leaf1_r02_c01.png",
    "aspect": 1.01,
    "w": 210,
    "h": 208
  },
  {
    "id": "batch1-r02-c02",
    "batch": "batch1",
    "row": 2,
    "col": 2,
    "url": "/leaves/batch1/v2_leaf1_r02_c02.png",
    "aspect": 1.029,
    "w": 215,
    "h": 209
  },
  {
    "id": "batch1-r02-c03",
    "batch": "batch1",
    "row": 2,
    "col": 3,
    "url": "/leaves/batch1/v2_leaf1_r02_c03.png",
    "aspect": 1.024,
    "w": 215,
    "h": 210
  },
  {
    "id": "batch1-r02-c04",
    "batch": "batch1",
    "row": 2,
    "col": 4,
    "url": "/leaves/batch1/v2_leaf1_r02_c04.png",
    "aspect": 0.976,
    "w": 203,
    "h": 208
  },
  {
    "id": "batch1-r02-c06",
    "batch": "batch1",
    "row": 2,
    "col": 6,
    "url": "/leaves/batch1/v2_leaf1_r02_c06.png",
    "aspect": 1,
    "w": 208,
    "h": 208
  },
  {
    "id": "batch1-r02-c10",
    "batch": "batch1",
    "row": 2,
    "col": 10,
    "url": "/leaves/batch1/v2_leaf1_r02_c10.png",
    "aspect": 0.995,
    "w": 206,
    "h": 207
  },
  {
    "id": "batch1-r03-c01",
    "batch": "batch1",
    "row": 3,
    "col": 1,
    "url": "/leaves/batch1/v2_leaf1_r03_c01.png",
    "aspect": 1.045,
    "w": 209,
    "h": 200
  },
  {
    "id": "batch1-r03-c02",
    "batch": "batch1",
    "row": 3,
    "col": 2,
    "url": "/leaves/batch1/v2_leaf1_r03_c02.png",
    "aspect": 1.04,
    "w": 208,
    "h": 200
  },
  {
    "id": "batch1-r03-c03",
    "batch": "batch1",
    "row": 3,
    "col": 3,
    "url": "/leaves/batch1/v2_leaf1_r03_c03.png",
    "aspect": 1.02,
    "w": 203,
    "h": 199
  },
  {
    "id": "batch1-r03-c04",
    "batch": "batch1",
    "row": 3,
    "col": 4,
    "url": "/leaves/batch1/v2_leaf1_r03_c04.png",
    "aspect": 1,
    "w": 196,
    "h": 196
  },
  {
    "id": "batch1-r03-c06",
    "batch": "batch1",
    "row": 3,
    "col": 6,
    "url": "/leaves/batch1/v2_leaf1_r03_c06.png",
    "aspect": 1.03,
    "w": 206,
    "h": 200
  },
  {
    "id": "batch1-r03-c10",
    "batch": "batch1",
    "row": 3,
    "col": 10,
    "url": "/leaves/batch1/v2_leaf1_r03_c10.png",
    "aspect": 0.995,
    "w": 199,
    "h": 200
  },
  {
    "id": "batch1-r04-c01",
    "batch": "batch1",
    "row": 4,
    "col": 1,
    "url": "/leaves/batch1/v2_leaf1_r04_c01.png",
    "aspect": 1.097,
    "w": 204,
    "h": 186
  },
  {
    "id": "batch1-r04-c02",
    "batch": "batch1",
    "row": 4,
    "col": 2,
    "url": "/leaves/batch1/v2_leaf1_r04_c02.png",
    "aspect": 1.119,
    "w": 207,
    "h": 185
  },
  {
    "id": "batch1-r04-c03",
    "batch": "batch1",
    "row": 4,
    "col": 3,
    "url": "/leaves/batch1/v2_leaf1_r04_c03.png",
    "aspect": 1.28,
    "w": 210,
    "h": 164
  },
  {
    "id": "batch1-r04-c04",
    "batch": "batch1",
    "row": 4,
    "col": 4,
    "url": "/leaves/batch1/v2_leaf1_r04_c04.png",
    "aspect": 1.145,
    "w": 189,
    "h": 165
  },
  {
    "id": "batch1-r04-c06",
    "batch": "batch1",
    "row": 4,
    "col": 6,
    "url": "/leaves/batch1/v2_leaf1_r04_c06.png",
    "aspect": 1.043,
    "w": 193,
    "h": 185
  },
  {
    "id": "batch1-r04-c10",
    "batch": "batch1",
    "row": 4,
    "col": 10,
    "url": "/leaves/batch1/v2_leaf1_r04_c10.png",
    "aspect": 1.043,
    "w": 193,
    "h": 185
  },
  {
    "id": "batch1-r05-c01",
    "batch": "batch1",
    "row": 5,
    "col": 1,
    "url": "/leaves/batch1/v2_leaf1_r05_c01.png",
    "aspect": 1.085,
    "w": 205,
    "h": 189
  },
  {
    "id": "batch1-r05-c02",
    "batch": "batch1",
    "row": 5,
    "col": 2,
    "url": "/leaves/batch1/v2_leaf1_r05_c02.png",
    "aspect": 1.086,
    "w": 203,
    "h": 187
  },
  {
    "id": "batch1-r05-c03",
    "batch": "batch1",
    "row": 5,
    "col": 3,
    "url": "/leaves/batch1/v2_leaf1_r05_c03.png",
    "aspect": 1.058,
    "w": 200,
    "h": 189
  },
  {
    "id": "batch1-r05-c04",
    "batch": "batch1",
    "row": 5,
    "col": 4,
    "url": "/leaves/batch1/v2_leaf1_r05_c04.png",
    "aspect": 1.043,
    "w": 196,
    "h": 188
  },
  {
    "id": "batch1-r05-c05",
    "batch": "batch1",
    "row": 5,
    "col": 5,
    "url": "/leaves/batch1/v2_leaf1_r05_c05.png",
    "aspect": 1.059,
    "w": 199,
    "h": 188
  },
  {
    "id": "batch1-r05-c06",
    "batch": "batch1",
    "row": 5,
    "col": 6,
    "url": "/leaves/batch1/v2_leaf1_r05_c06.png",
    "aspect": 1.054,
    "w": 196,
    "h": 186
  },
  {
    "id": "batch1-r05-c10",
    "batch": "batch1",
    "row": 5,
    "col": 10,
    "url": "/leaves/batch1/v2_leaf1_r05_c10.png",
    "aspect": 1.038,
    "w": 193,
    "h": 186
  },
  {
    "id": "batch1-r06-c01",
    "batch": "batch1",
    "row": 6,
    "col": 1,
    "url": "/leaves/batch1/v2_leaf1_r06_c01.png",
    "aspect": 1.095,
    "w": 207,
    "h": 189
  },
  {
    "id": "batch1-r06-c02",
    "batch": "batch1",
    "row": 6,
    "col": 2,
    "url": "/leaves/batch1/v2_leaf1_r06_c02.png",
    "aspect": 1.086,
    "w": 203,
    "h": 187
  },
  {
    "id": "batch1-r06-c03",
    "batch": "batch1",
    "row": 6,
    "col": 3,
    "url": "/leaves/batch1/v2_leaf1_r06_c03.png",
    "aspect": 1.075,
    "w": 200,
    "h": 186
  },
  {
    "id": "batch1-r06-c04",
    "batch": "batch1",
    "row": 6,
    "col": 4,
    "url": "/leaves/batch1/v2_leaf1_r06_c04.png",
    "aspect": 1.027,
    "w": 191,
    "h": 186
  },
  {
    "id": "batch1-r06-c05",
    "batch": "batch1",
    "row": 6,
    "col": 5,
    "url": "/leaves/batch1/v2_leaf1_r06_c05.png",
    "aspect": 0.995,
    "w": 184,
    "h": 185
  },
  {
    "id": "batch1-r06-c06",
    "batch": "batch1",
    "row": 6,
    "col": 6,
    "url": "/leaves/batch1/v2_leaf1_r06_c06.png",
    "aspect": 1.021,
    "w": 191,
    "h": 187
  },
  {
    "id": "batch1-r06-c10",
    "batch": "batch1",
    "row": 6,
    "col": 10,
    "url": "/leaves/batch1/v2_leaf1_r06_c10.png",
    "aspect": 0.995,
    "w": 184,
    "h": 185
  },
  {
    "id": "batch1-r07-c01",
    "batch": "batch1",
    "row": 7,
    "col": 1,
    "url": "/leaves/batch1/v2_leaf1_r07_c01.png",
    "aspect": 1.046,
    "w": 204,
    "h": 195
  },
  {
    "id": "batch1-r07-c02",
    "batch": "batch1",
    "row": 7,
    "col": 2,
    "url": "/leaves/batch1/v2_leaf1_r07_c02.png",
    "aspect": 1.051,
    "w": 205,
    "h": 195
  },
  {
    "id": "batch1-r07-c03",
    "batch": "batch1",
    "row": 7,
    "col": 3,
    "url": "/leaves/batch1/v2_leaf1_r07_c03.png",
    "aspect": 1.026,
    "w": 200,
    "h": 195
  },
  {
    "id": "batch1-r07-c04",
    "batch": "batch1",
    "row": 7,
    "col": 4,
    "url": "/leaves/batch1/v2_leaf1_r07_c04.png",
    "aspect": 1.031,
    "w": 199,
    "h": 193
  },
  {
    "id": "batch1-r07-c05",
    "batch": "batch1",
    "row": 7,
    "col": 5,
    "url": "/leaves/batch1/v2_leaf1_r07_c05.png",
    "aspect": 1.01,
    "w": 197,
    "h": 195
  },
  {
    "id": "batch1-r07-c06",
    "batch": "batch1",
    "row": 7,
    "col": 6,
    "url": "/leaves/batch1/v2_leaf1_r07_c06.png",
    "aspect": 1.057,
    "w": 205,
    "h": 194
  },
  {
    "id": "batch2-r01-c01",
    "batch": "batch2",
    "row": 1,
    "col": 1,
    "url": "/leaves/batch2/v2_leaf2_r01_c01.png",
    "aspect": 0.986,
    "w": 209,
    "h": 212
  },
  {
    "id": "batch2-r01-c02",
    "batch": "batch2",
    "row": 1,
    "col": 2,
    "url": "/leaves/batch2/v2_leaf2_r01_c02.png",
    "aspect": 0.967,
    "w": 205,
    "h": 212
  },
  {
    "id": "batch2-r01-c03",
    "batch": "batch2",
    "row": 1,
    "col": 3,
    "url": "/leaves/batch2/v2_leaf2_r01_c03.png",
    "aspect": 0.986,
    "w": 208,
    "h": 211
  },
  {
    "id": "batch2-r01-c04",
    "batch": "batch2",
    "row": 1,
    "col": 4,
    "url": "/leaves/batch2/v2_leaf2_r01_c04.png",
    "aspect": 0.977,
    "w": 208,
    "h": 213
  },
  {
    "id": "batch2-r01-c05",
    "batch": "batch2",
    "row": 1,
    "col": 5,
    "url": "/leaves/batch2/v2_leaf2_r01_c05.png",
    "aspect": 0.977,
    "w": 208,
    "h": 213
  },
  {
    "id": "batch2-r01-c06",
    "batch": "batch2",
    "row": 1,
    "col": 6,
    "url": "/leaves/batch2/v2_leaf2_r01_c06.png",
    "aspect": 0.962,
    "w": 204,
    "h": 212
  },
  {
    "id": "batch2-r01-c07",
    "batch": "batch2",
    "row": 1,
    "col": 7,
    "url": "/leaves/batch2/v2_leaf2_r01_c07.png",
    "aspect": 0.962,
    "w": 204,
    "h": 212
  },
  {
    "id": "batch2-r01-c08",
    "batch": "batch2",
    "row": 1,
    "col": 8,
    "url": "/leaves/batch2/v2_leaf2_r01_c08.png",
    "aspect": 0.967,
    "w": 204,
    "h": 211
  },
  {
    "id": "batch2-r01-c09",
    "batch": "batch2",
    "row": 1,
    "col": 9,
    "url": "/leaves/batch2/v2_leaf2_r01_c09.png",
    "aspect": 0.958,
    "w": 204,
    "h": 213
  },
  {
    "id": "batch2-r02-c01",
    "batch": "batch2",
    "row": 2,
    "col": 1,
    "url": "/leaves/batch2/v2_leaf2_r02_c01.png",
    "aspect": 1.019,
    "w": 216,
    "h": 212
  },
  {
    "id": "batch2-r02-c02",
    "batch": "batch2",
    "row": 2,
    "col": 2,
    "url": "/leaves/batch2/v2_leaf2_r02_c02.png",
    "aspect": 0.99,
    "w": 207,
    "h": 209
  },
  {
    "id": "batch2-r02-c03",
    "batch": "batch2",
    "row": 2,
    "col": 3,
    "url": "/leaves/batch2/v2_leaf2_r02_c03.png",
    "aspect": 1.005,
    "w": 209,
    "h": 208
  },
  {
    "id": "batch2-r02-c04",
    "batch": "batch2",
    "row": 2,
    "col": 4,
    "url": "/leaves/batch2/v2_leaf2_r02_c04.png",
    "aspect": 1.005,
    "w": 211,
    "h": 210
  },
  {
    "id": "batch2-r02-c05",
    "batch": "batch2",
    "row": 2,
    "col": 5,
    "url": "/leaves/batch2/v2_leaf2_r02_c05.png",
    "aspect": 0.991,
    "w": 211,
    "h": 213
  },
  {
    "id": "batch2-r02-c06",
    "batch": "batch2",
    "row": 2,
    "col": 6,
    "url": "/leaves/batch2/v2_leaf2_r02_c06.png",
    "aspect": 0.976,
    "w": 207,
    "h": 212
  },
  {
    "id": "batch2-r02-c07",
    "batch": "batch2",
    "row": 2,
    "col": 7,
    "url": "/leaves/batch2/v2_leaf2_r02_c07.png",
    "aspect": 0.948,
    "w": 200,
    "h": 211
  },
  {
    "id": "batch2-r02-c08",
    "batch": "batch2",
    "row": 2,
    "col": 8,
    "url": "/leaves/batch2/v2_leaf2_r02_c08.png",
    "aspect": 0.967,
    "w": 203,
    "h": 210
  },
  {
    "id": "batch2-r02-c09",
    "batch": "batch2",
    "row": 2,
    "col": 9,
    "url": "/leaves/batch2/v2_leaf2_r02_c09.png",
    "aspect": 0.962,
    "w": 204,
    "h": 212
  },
  {
    "id": "batch2-r03-c01",
    "batch": "batch2",
    "row": 3,
    "col": 1,
    "url": "/leaves/batch2/v2_leaf2_r03_c01.png",
    "aspect": 0.991,
    "w": 214,
    "h": 216
  },
  {
    "id": "batch2-r03-c02",
    "batch": "batch2",
    "row": 3,
    "col": 2,
    "url": "/leaves/batch2/v2_leaf2_r03_c02.png",
    "aspect": 0.967,
    "w": 204,
    "h": 211
  },
  {
    "id": "batch2-r03-c03",
    "batch": "batch2",
    "row": 3,
    "col": 3,
    "url": "/leaves/batch2/v2_leaf2_r03_c03.png",
    "aspect": 0.995,
    "w": 214,
    "h": 215
  },
  {
    "id": "batch2-r03-c04",
    "batch": "batch2",
    "row": 3,
    "col": 4,
    "url": "/leaves/batch2/v2_leaf2_r03_c04.png",
    "aspect": 1,
    "w": 214,
    "h": 214
  },
  {
    "id": "batch2-r03-c05",
    "batch": "batch2",
    "row": 3,
    "col": 5,
    "url": "/leaves/batch2/v2_leaf2_r03_c05.png",
    "aspect": 0.958,
    "w": 204,
    "h": 213
  },
  {
    "id": "batch2-r03-c06",
    "batch": "batch2",
    "row": 3,
    "col": 6,
    "url": "/leaves/batch2/v2_leaf2_r03_c06.png",
    "aspect": 0.949,
    "w": 203,
    "h": 214
  },
  {
    "id": "batch2-r03-c07",
    "batch": "batch2",
    "row": 3,
    "col": 7,
    "url": "/leaves/batch2/v2_leaf2_r03_c07.png",
    "aspect": 0.958,
    "w": 206,
    "h": 215
  },
  {
    "id": "batch2-r03-c08",
    "batch": "batch2",
    "row": 3,
    "col": 8,
    "url": "/leaves/batch2/v2_leaf2_r03_c08.png",
    "aspect": 0.949,
    "w": 204,
    "h": 215
  },
  {
    "id": "batch2-r03-c09",
    "batch": "batch2",
    "row": 3,
    "col": 9,
    "url": "/leaves/batch2/v2_leaf2_r03_c09.png",
    "aspect": 0.944,
    "w": 204,
    "h": 216
  },
  {
    "id": "batch2-r04-c01",
    "batch": "batch2",
    "row": 4,
    "col": 1,
    "url": "/leaves/batch2/v2_leaf2_r04_c01.png",
    "aspect": 0.995,
    "w": 216,
    "h": 217
  },
  {
    "id": "batch2-r04-c02",
    "batch": "batch2",
    "row": 4,
    "col": 2,
    "url": "/leaves/batch2/v2_leaf2_r04_c02.png",
    "aspect": 0.931,
    "w": 202,
    "h": 217
  },
  {
    "id": "batch2-r04-c03",
    "batch": "batch2",
    "row": 4,
    "col": 3,
    "url": "/leaves/batch2/v2_leaf2_r04_c03.png",
    "aspect": 0.936,
    "w": 205,
    "h": 219
  },
  {
    "id": "batch2-r04-c04",
    "batch": "batch2",
    "row": 4,
    "col": 4,
    "url": "/leaves/batch2/v2_leaf2_r04_c04.png",
    "aspect": 0.959,
    "w": 209,
    "h": 218
  },
  {
    "id": "batch2-r04-c05",
    "batch": "batch2",
    "row": 4,
    "col": 5,
    "url": "/leaves/batch2/v2_leaf2_r04_c05.png",
    "aspect": 0.945,
    "w": 206,
    "h": 218
  },
  {
    "id": "batch2-r04-c06",
    "batch": "batch2",
    "row": 4,
    "col": 6,
    "url": "/leaves/batch2/v2_leaf2_r04_c06.png",
    "aspect": 0.949,
    "w": 206,
    "h": 217
  },
  {
    "id": "batch2-r04-c07",
    "batch": "batch2",
    "row": 4,
    "col": 7,
    "url": "/leaves/batch2/v2_leaf2_r04_c07.png",
    "aspect": 0.94,
    "w": 204,
    "h": 217
  },
  {
    "id": "batch2-r04-c08",
    "batch": "batch2",
    "row": 4,
    "col": 8,
    "url": "/leaves/batch2/v2_leaf2_r04_c08.png",
    "aspect": 0.922,
    "w": 201,
    "h": 218
  },
  {
    "id": "batch2-r04-c09",
    "batch": "batch2",
    "row": 4,
    "col": 9,
    "url": "/leaves/batch2/v2_leaf2_r04_c09.png",
    "aspect": 0.963,
    "w": 211,
    "h": 219
  },
  {
    "id": "batch2-r05-c01",
    "batch": "batch2",
    "row": 5,
    "col": 1,
    "url": "/leaves/batch2/v2_leaf2_r05_c01.png",
    "aspect": 0.973,
    "w": 215,
    "h": 221
  },
  {
    "id": "batch2-r05-c02",
    "batch": "batch2",
    "row": 5,
    "col": 2,
    "url": "/leaves/batch2/v2_leaf2_r05_c02.png",
    "aspect": 0.94,
    "w": 205,
    "h": 218
  },
  {
    "id": "batch2-r05-c03",
    "batch": "batch2",
    "row": 5,
    "col": 3,
    "url": "/leaves/batch2/v2_leaf2_r05_c03.png",
    "aspect": 0.954,
    "w": 209,
    "h": 219
  },
  {
    "id": "batch2-r05-c04",
    "batch": "batch2",
    "row": 5,
    "col": 4,
    "url": "/leaves/batch2/v2_leaf2_r05_c04.png",
    "aspect": 0.95,
    "w": 209,
    "h": 220
  },
  {
    "id": "batch2-r05-c05",
    "batch": "batch2",
    "row": 5,
    "col": 5,
    "url": "/leaves/batch2/v2_leaf2_r05_c05.png",
    "aspect": 0.922,
    "w": 202,
    "h": 219
  },
  {
    "id": "batch2-r05-c06",
    "batch": "batch2",
    "row": 5,
    "col": 6,
    "url": "/leaves/batch2/v2_leaf2_r05_c06.png",
    "aspect": 0.945,
    "w": 207,
    "h": 219
  },
  {
    "id": "batch2-r05-c07",
    "batch": "batch2",
    "row": 5,
    "col": 7,
    "url": "/leaves/batch2/v2_leaf2_r05_c07.png",
    "aspect": 0.95,
    "w": 209,
    "h": 220
  },
  {
    "id": "batch2-r05-c08",
    "batch": "batch2",
    "row": 5,
    "col": 8,
    "url": "/leaves/batch2/v2_leaf2_r05_c08.png",
    "aspect": 0.927,
    "w": 204,
    "h": 220
  },
  {
    "id": "batch2-r05-c09",
    "batch": "batch2",
    "row": 5,
    "col": 9,
    "url": "/leaves/batch2/v2_leaf2_r05_c09.png",
    "aspect": 0.918,
    "w": 202,
    "h": 220
  },
  {
    "id": "batch2-r06-c01",
    "batch": "batch2",
    "row": 6,
    "col": 1,
    "url": "/leaves/batch2/v2_leaf2_r06_c01.png",
    "aspect": 0.972,
    "w": 209,
    "h": 215
  },
  {
    "id": "batch2-r06-c02",
    "batch": "batch2",
    "row": 6,
    "col": 2,
    "url": "/leaves/batch2/v2_leaf2_r06_c02.png",
    "aspect": 0.94,
    "w": 203,
    "h": 216
  },
  {
    "id": "batch2-r06-c03",
    "batch": "batch2",
    "row": 6,
    "col": 3,
    "url": "/leaves/batch2/v2_leaf2_r06_c03.png",
    "aspect": 0.972,
    "w": 209,
    "h": 215
  },
  {
    "id": "batch2-r06-c04",
    "batch": "batch2",
    "row": 6,
    "col": 4,
    "url": "/leaves/batch2/v2_leaf2_r06_c04.png",
    "aspect": 0.981,
    "w": 210,
    "h": 214
  },
  {
    "id": "batch2-r06-c05",
    "batch": "batch2",
    "row": 6,
    "col": 5,
    "url": "/leaves/batch2/v2_leaf2_r06_c05.png",
    "aspect": 0.94,
    "w": 202,
    "h": 215
  },
  {
    "id": "batch2-r06-c06",
    "batch": "batch2",
    "row": 6,
    "col": 6,
    "url": "/leaves/batch2/v2_leaf2_r06_c06.png",
    "aspect": 0.94,
    "w": 203,
    "h": 216
  },
  {
    "id": "batch2-r06-c07",
    "batch": "batch2",
    "row": 6,
    "col": 7,
    "url": "/leaves/batch2/v2_leaf2_r06_c07.png",
    "aspect": 0.954,
    "w": 206,
    "h": 216
  },
  {
    "id": "batch2-r06-c08",
    "batch": "batch2",
    "row": 6,
    "col": 8,
    "url": "/leaves/batch2/v2_leaf2_r06_c08.png",
    "aspect": 0.927,
    "w": 202,
    "h": 218
  }
]

export const LEAF_CARD_BY_ID = new Map(LEAF_CARDS.map((c) => [c.id, c]))

export function leafCardsFor(batch, row) {
  return LEAF_CARDS.filter((c) => c.batch === batch && c.row === row)
}

export function leafCardRows(batch) {
  return Object.keys(LEAF_CARD_BATCHES[batch] || {}).map(Number).sort((a, b) => a - b)
}
