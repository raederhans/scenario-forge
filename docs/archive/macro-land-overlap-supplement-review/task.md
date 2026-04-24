# 任务
目标：只读判断 tno_labrador_sea、tno_gulf_of_alaska、tno_tasman_sea 三个 macro_land_overlap 的最短修法。
范围：检查当前 spec 的 supplement_bboxes、相关 validator probe 点、以及是否必须依赖 supplement 才能命中 probe。
限制：不改代码，只输出每个 feature 的建议：删掉 supplement、缩小 supplement，还是保留。
