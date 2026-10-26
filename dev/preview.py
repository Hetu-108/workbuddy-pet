"""把 README.md 渲成一张本地预览图，用来在推送前肉眼验收排版。

只是验收工具，不是渲染器——只覆盖 README 里真正用到的语法子集
（标题 / 段落 / 表格 / 代码块 / 引用 / 列表 / 加粗 / 行内码 / 链接 / details，
以及原样透传的 <p align> <img> <kbd> 等行级 HTML）。

用法：python dev/preview.py     → 生成 dev/_readme-preview.html
"""
import html
import io
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'README.md')
OUT = os.path.join(ROOT, '_readme-preview.html')   # 放在仓库根，相对图片路径才对


KEEP = r'kbd|br|b|strong|i|em|code|sub|sup|img|a'


def inline(t):
    # 只转义真正的文本，保留 GitHub 允许的行内 HTML（<kbd> 之类）
    t = t.replace('&', '&amp;')
    t = re.sub(r'<(?!\/?(?:' + KEEP + r')\b)', '&lt;', t)
    t = re.sub(r'`([^`]+)`', r'<code>\1</code>', t)
    t = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', t)
    t = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', t)
    return t


def convert(md):
    lines = md.split('\n')
    out = []
    i = 0
    n = len(lines)

    while i < n:
        line = lines[i]

        # 代码块
        if line.startswith('```'):
            i += 1
            buf = []
            while i < n and not lines[i].startswith('```'):
                buf.append(html.escape(lines[i]))
                i += 1
            i += 1
            out.append('<pre><code>' + '\n'.join(buf) + '</code></pre>')
            continue

        # HTML 块：从 < 开头的行起，一直透传到下一个空行（GitHub 的规则也是如此）
        if line.startswith('<'):
            buf = []
            while i < n and lines[i].strip():
                buf.append(lines[i])
                i += 1
            out.append('\n'.join(buf))
            continue

        # 标题
        m = re.match(r'^(#{1,4})\s+(.*)$', line)
        if m:
            lv = len(m.group(1))
            out.append(f'<h{lv}>{inline(m.group(2))}</h{lv}>')
            i += 1
            continue

        # 分隔线
        if line.strip() == '---':
            out.append('<hr>')
            i += 1
            continue

        # 表格
        if line.startswith('|') and i + 1 < n and re.match(r'^\|\s*-{3}', lines[i + 1]):
            head = [c.strip() for c in line.strip('|').split('|')]
            i += 2
            rows = []
            while i < n and lines[i].startswith('|'):
                rows.append([c.strip() for c in lines[i].strip('|').split('|')])
                i += 1
            t = ['<table><thead><tr>']
            t += [f'<th>{inline(c)}</th>' for c in head]
            t.append('</tr></thead><tbody>')
            for r in rows:
                t.append('<tr>' + ''.join(f'<td>{inline(c)}</td>' for c in r) + '</tr>')
            t.append('</tbody></table>')
            out.append(''.join(t))
            continue

        # 引用
        if line.startswith('> '):
            buf = []
            while i < n and lines[i].startswith('> '):
                buf.append(inline(lines[i][2:]))
                i += 1
            out.append('<blockquote>' + '<br>'.join(buf) + '</blockquote>')
            continue

        # 列表
        if re.match(r'^[-*]\s+', line):
            buf = []
            while i < n and re.match(r'^[-*]\s+', lines[i]):
                buf.append('<li>' + inline(re.sub(r'^[-*]\s+', '', lines[i])) + '</li>')
                i += 1
            out.append('<ul>' + ''.join(buf) + '</ul>')
            continue

        # 空行
        if not line.strip():
            i += 1
            continue

        # 段落（连续非空行合并）
        buf = []
        while i < n and lines[i].strip() and not lines[i].startswith(('#', '|', '>', '```', '<')) \
                and not re.match(r'^[-*]\s+', lines[i]) and lines[i].strip() != '---':
            buf.append(inline(lines[i].strip()))
            i += 1
        out.append('<p>' + '<br>'.join(buf) + '</p>')

    return '\n'.join(out)


CSS = """
* { box-sizing: border-box; }
body {
  margin: 0; padding: 32px 24px 64px;
  width: 928px; background: #fff;
  font-family: -apple-system, 'Segoe UI', 'Microsoft YaHei', 'PingFang SC', sans-serif;
  font-size: 16px; line-height: 1.6; color: #1F2328;
  -webkit-font-smoothing: antialiased;
}
h1 { font-size: 32px; font-weight: 600; padding-bottom: .3em; border-bottom: 1px solid #d8dee4; margin: 0 0 16px; }
h2 { font-size: 24px; font-weight: 600; padding-bottom: .3em; border-bottom: 1px solid #d8dee4; margin: 32px 0 16px; }
h3 { font-size: 20px; font-weight: 600; margin: 24px 0 16px; }
p { margin: 0 0 16px; }
a { color: #0969da; text-decoration: none; }
a:hover { text-decoration: underline; }
ul { margin: 0 0 16px; padding-left: 2em; }
li { margin: 4px 0; }
hr { height: 4px; padding: 0; margin: 24px 0; background: #d0d7de; border: 0; opacity: .35; }
blockquote { margin: 0 0 16px; padding: 0 1em; color: #59636e; border-left: .25em solid #d1d9e0; }
code {
  padding: .2em .4em; font-size: 85%; background: rgba(129,139,152,.12);
  border-radius: 6px; font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
}
pre { background: #f6f8fa; padding: 16px; border-radius: 6px; overflow: auto; margin: 0 0 16px; }
pre code { background: none; padding: 0; font-size: 85%; }
table { border-collapse: collapse; margin: 0 0 16px; display: block; overflow: auto; }
th, td { border: 1px solid #d1d9e0; padding: 6px 13px; }
th { font-weight: 600; background: #f6f8fa; }
tr:nth-child(2n) td { background: #f6f8fa; }
kbd {
  display: inline-block; padding: 3px 5px; font-size: 11px; line-height: 10px;
  font-family: ui-monospace, Consolas, monospace; color: #1F2328;
  background: #f6f8fa; border: 1px solid #d1d9e0; border-bottom-color: #b6bfc9;
  border-radius: 6px; box-shadow: inset 0 -1px 0 #b6bfc9;
}
details { margin: 0 0 16px; }
summary { cursor: pointer; margin-bottom: 8px; }
img { max-width: 100%; }
"""


def main():
    md = io.open(SRC, encoding='utf-8').read()
    body = convert(md)
    doc = f"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>README preview</title>
<style>{CSS}</style></head><body>{body}</body></html>"""
    io.open(OUT, 'w', encoding='utf-8').write(doc)
    print('written', OUT, len(doc), 'bytes')


if __name__ == '__main__':
    main()
