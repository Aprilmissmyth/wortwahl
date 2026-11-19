# Wortwahl

**不背单词，用规律猜德语。** 一个给中文母语、会一点英语的德语初学者用的划卡小游戏。

多数背词软件让你一个一个记单词。Wortwahl 先教你一条规律，再让你用它去猜从没学过的词，比如：

- 英语 `t` 常对应德语 `z`、`ss`：water → **Wasser**，heart → **Herz**
- 复合词拆开就能猜：Faul（懒）+ Tier（动物）= **Faultier**（树懒）
- 看词尾判断词性：以 `-ung` 结尾的名词几乎都是 **die**

每课都藏着一两个例外“陷阱”（tea → **Tee**，不是 Zee），提醒你规律不是万能的。猜过的词会自动进入间隔复习，过一段时间换个考法再出现。

## 内容

- **13 节规律课，126 个测试词**
  - 从英语猜德语：t → z/ss、p → pf/f、d → t、th → d、k → ch、gh → ch
  - 拆开复合词：拆开猜意思、词性看最后一部分、形容词词尾 -los/-voll/-ig/-lich
  - 从词尾看词性：-ung/-heit/-keit/-schaft/-ion → die，-chen/-lein → das，动词 + er → der
  - 名词复数的两条可靠规律
- **109 个 A1 常用词**，按遗忘规律安排复习，名词另外练 der/die/das
- 每个词都有发音

## 怎么玩

把卡片划向正确答案的一边，词性题是左划 der、右划 die、上划 das。电脑上可以用 ← → ↑ 键作答，空格重听，回车继续。

进度保存在浏览器本地（localStorage），可以在“设置与进度”里导出和导入。

## 运行

纯静态网页，不需要安装任何东西：

- 在线：部署到 GitHub Pages 后直接打开链接
- 本地：在项目目录运行 `python3 -m http.server`，然后打开 `http://localhost:8000`

## 项目结构

```
index.html            页面
css/style.css         样式
js/app.js             游戏逻辑
js/words.js           由 data/words.json 生成
js/rules.js           由 data/rules.json 生成
data/words.json       A1 词表（手写）
data/rules.json       规律课内容（手写）
audio/                由 tools/build.py 合成的发音
tools/build.py        生成 js/*.js 和发音
```

## 修改内容

改完 `data/words.json` 或 `data/rules.json` 后重新生成：

```bash
pip install -r tools/requirements.txt
python3 -m piper.download_voices de_DE-thorsten-medium de_DE-kerstin-medium --data-dir voices
python3 tools/build.py --voices-dir voices
```

用哪些音色由 `data/voices.json` 决定，每个音色的发音放在 `audio/<音色 id>/` 下，玩家可以在设置里切换。只改了文字、不需要新发音时，可以用 `python3 tools/build.py --no-audio`；删掉词以后，用 `--prune` 清理不再使用的发音文件。

`rules.json` 里每节课包含：`explain`（规律说明）、`examples`（例子）和 `tests`（测试词）。测试词的 `type` 可以是：

| type | 考什么 | 主要字段 |
|---|---|---|
| `cognate` | 从英语推德语 | `en`、`de`、`wrong` |
| `compound` | 从组成部分猜意思 | `de`、`parts`、`zh`、`wrong` |
| `cgender` | 复合词的词性 | `de`、`parts`（部件和词性）、`gender` |
| `gender` | 从词尾判断词性 | `de`、`gender` |
| `form` | 选出正确的词形（如复数） | `q`、`de`、`article`、`wrong` |

带 `trap` 字段的测试词是例外，答完后会显示这段解释。

## 说明

- 规律描述的是“大多数情况”。测试词特意挑选了符合规律的词，例外单独标成陷阱。
- 词表、规律和中文说明由 AI 辅助编写，没有经过德语母语者审校，发现错误欢迎提 issue。
- 发音是合成的，不是真人录音。

## 许可

代码和内容使用 [MIT 许可证](LICENSE)。

## 致谢

- 发音由 [Piper](https://github.com/OHF-Voice/piper1-gpl)（GPL-3.0）合成。Piper 只在生成发音时作为工具使用，游戏本身不包含也不依赖它。
- 男声：thorsten（中等质量），录音来自 [Thorsten-Voice](https://github.com/thorstenMueller/Thorsten-Voice)（CC0）。
- 女声：kerstin，录音来自 [OHF-Voice voice-datasets](https://github.com/OHF-Voice/voice-datasets)（CC0），模型在 Hi-Fi TTS 英语音色的基础上训练。
