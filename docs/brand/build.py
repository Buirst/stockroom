# Builds the Stockroom logo files in docs/brand/ from the geometry below.
# python docs/brand/build.py <JetBrainsMono-ExtraBold.ttf>   (needs fontTools; the font is OFL, from Google Fonts)
import os
import sys
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

OUT = os.path.dirname(os.path.abspath(__file__))
INK, CREAM, CHARCOAL = '#1a1714', '#ece5d8', '#0f0e0d'
LIT = ('#7ee0c3', '#f4c56a')  # same on every background: the bin's outline carries the contrast

# Symbol on a 256 grid: two identical bins on a shelf. The one that is on is lit inside with an empty label; the one
# that is off is empty inside, label still on. The one-colour version fills the lit bin solid.
LIT_BIN = ('M27 58H117A5 5 0 0 1 122 63V73A5 5 0 0 1 117 78H114V146A12 12 0 0 1 102 158H42A12 12 0 0 1 30 146V78'
           'H27A5 5 0 0 1 22 73V63A5 5 0 0 1 27 58ZM55 104V124H89V104Z')
OFF_BIN = ('M139 58H229A5 5 0 0 1 234 63V73A5 5 0 0 1 229 78H226V146A12 12 0 0 1 214 158H154A12 12 0 0 1 142 146V78'
           'H139A5 5 0 0 1 134 73V63A5 5 0 0 1 139 58ZM154 78V143A3 3 0 0 0 157 146H211A3 3 0 0 0 214 143V78Z')
OFF_LABEL = '<rect x="167" y="104" width="34" height="20" rx="3"/>'
LIT_INSIDE = 'M41 77H103V143A4 4 0 0 1 99 147H45A4 4 0 0 1 41 143ZM55 104V124H89V104Z'  # 1 unit under the outline: no seam
SHELF = '<rect x="12" y="168" width="232" height="18" rx="4"/>'
BOX = (12, 58, 232, 128)  # x, y, w, h of the drawing

# Small cut for 16-32 px: no lips or labels, thicker walls.
SMALL = ('<path fill-rule="evenodd" d="M24 48H112A8 8 0 0 1 120 56V172A8 8 0 0 1 112 180H24A8 8 0 0 1 16 172V56'
         'A8 8 0 0 1 24 48Z"/>{off}<rect x="8" y="196" width="240" height="28" rx="6"/>')
SMALL_OFF = ('<path fill-rule="evenodd" d="M144 48H232A8 8 0 0 1 240 56V172A8 8 0 0 1 232 180H144A8 8 0 0 1 136 172V56'
             'A8 8 0 0 1 144 48ZM164 76V152H212V76Z"/>')


def symbol(ink, lit, gid):
    """Symbol markup in the 256 grid. lit = (from, to) gradient, or None for one colour."""
    if lit is None:
        return f'<g fill="{ink}"><path fill-rule="evenodd" d="{LIT_BIN}"/><path fill-rule="evenodd" d="{OFF_BIN}"/>{OFF_LABEL}{SHELF}</g>'
    grad = (f'<linearGradient id="{gid}" gradientUnits="userSpaceOnUse" x1="41" y1="147" x2="103" y2="77">'
            f'<stop offset="0" stop-color="{lit[0]}"/><stop offset="1" stop-color="{lit[1]}"/></linearGradient>')
    return (f'<defs>{grad}</defs><path fill="url(#{gid})" fill-rule="evenodd" d="{LIT_INSIDE}"/>'
            f'<g fill="{ink}"><path fill-rule="evenodd" transform="translate(-112 0)" d="{OFF_BIN}"/>'
            f'<path fill-rule="evenodd" d="{OFF_BIN}"/>{OFF_LABEL}{SHELF}</g>')


def wordmark(font_path, size):
    """'stockroom' as one path, baseline at y=0; returns (d, width, ascender height)."""
    font = TTFont(font_path)
    gs, cmap = font.getGlyphSet(), font.getBestCmap()
    k = size / font['head'].unitsPerEm
    track = -20  # font units; the README charts use -0.02em
    pen, x = SVGPathPen(gs), 0
    for ch in 'stockroom':
        name = cmap[ord(ch)]
        gs[name].draw(TransformPen(pen, (k, 0, 0, -k, x, 0)))
        x += (gs[name].width + track) * k
    return pen.getCommands(), x - track * k, font['OS/2'].sCapHeight * k


def svg(w, h, body, title):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:g} {h:g}" role="img" aria-label="{title}">'
            f'<title>{title}</title>{body}</svg>\n')


def save(name, text):
    with open(os.path.join(OUT, name), 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)


def main(font_path):
    themes = {'light': (INK, LIT), 'dark': (CREAM, LIT)}  # named after the background they sit on
    for t, (ink, lit) in themes.items():
        save(f'symbol-{t}.svg', svg(256, 256, symbol(ink, lit, 'lit'), 'Stockroom'))
    save('symbol-black.svg', svg(256, 256, symbol('#000', None, ''), 'Stockroom'))
    save('symbol-white.svg', svg(256, 256, symbol('#fff', None, ''), 'Stockroom'))
    for t, (ink, _) in themes.items():
        save(f'symbol-small-{t}.svg', svg(256, 256, f'<g fill="{ink}">' + SMALL.format(off=SMALL_OFF) + '</g>', 'Stockroom'))

    size = 128
    d, ww, cap = wordmark(font_path, size)
    bx, by, bw, bh = BOX
    pad = 16
    # Horizontal: shelf bottom on the baseline, bins rise a little above the ascenders.
    s = cap * 1.3 / bh
    gap = size * 0.34
    W, H = pad * 2 + bw * s + gap + ww, pad * 2 + bh * s
    base = pad + bh * s
    sym_t = f'translate({pad:g} {pad:g}) scale({s:.5f}) translate({-bx} {-by})'
    word_t = f'translate({pad + bw * s + gap:.2f} {base:.2f})'
    for t, (ink, lit) in themes.items():
        body = f'<g transform="{sym_t}">{symbol(ink, lit, "lit")}</g><path fill="{ink}" transform="{word_t}" d="{d}"/>'
        save(f'lockup-{t}.svg', svg(round(W, 2), round(H, 2), body, 'Stockroom'))
    for name, ink in (('black', '#000'), ('white', '#fff')):
        body = f'<g transform="{sym_t}">{symbol(ink, None, "")}</g><path fill="{ink}" transform="{word_t}" d="{d}"/>'
        save(f'lockup-{name}.svg', svg(round(W, 2), round(H, 2), body, 'Stockroom'))

    # Stacked: symbol centred over the wordmark, half its width.
    s2 = ww * 0.5 / bw
    W2 = pad * 2 + ww
    H2 = pad * 2 + bh * s2 + size * 0.36 + cap
    sym2 = f'translate({pad + (ww - bw * s2) / 2:.2f} {pad:g}) scale({s2:.5f}) translate({-bx} {-by})'
    word2 = f'translate({pad:g} {H2 - pad:.2f})'
    for t, (ink, lit) in themes.items():
        body = f'<g transform="{sym2}">{symbol(ink, lit, "lit")}</g><path fill="{ink}" transform="{word2}" d="{d}"/>'
        save(f'stacked-{t}.svg', svg(round(W2, 2), round(H2, 2), body, 'Stockroom'))

    for t, (ink, _) in themes.items():
        save(f'wordmark-{t}.svg', svg(round(ww + pad * 2, 2), round(cap + pad * 2 + size * 0.24, 2),
                                      f'<path fill="{ink}" transform="translate({pad} {pad + cap:.2f})" d="{d}"/>', 'Stockroom'))

    # App icon: charcoal tile, symbol at 64 % width.
    icon = (f'<rect width="256" height="256" rx="56" fill="{CHARCOAL}"/>'
            f'<g transform="translate(128 128) scale(.64) translate(-128 -122)">{symbol(CREAM, LIT, "lit")}</g>')
    save('app-icon.svg', svg(256, 256, icon, 'Stockroom'))


if __name__ == '__main__':
    main(sys.argv[1])
