# make-icons.py — PWA 아이콘 생성
#
#   python make-icons.py
#
# 홈 화면에 추가했을 때 쓰이는 아이콘을 만든다.
#   icon-192.png            일반 아이콘 (둥근 사각형)
#   icon-512.png            일반 아이콘 큰 것
#   icon-maskable-512.png   maskable — 안드로이드가 원/사각 등 임의 모양으로 잘라낸다.
#                           그래서 그림을 가운데 80% 안에만 둬야 잘리지 않는다.
#   apple-touch-icon.png    iOS 홈 화면용 (180px, 투명·둥근모서리 없이 꽉 채움)

from PIL import Image, ImageDraw
from pathlib import Path

HERE = Path(__file__).parent
NAVY = (31, 78, 121)        # --accent #1f4e79
WHITE = (255, 255, 255)


def check_marks(d, size, scale=1.0, cy_shift=0.0):
    """가운데에 체크 표시를 그린다. scale=1.0 이면 아이콘 폭의 약 46%."""
    w = size * 0.10 * scale                      # 선 두께
    cx, cy = size / 2, size / 2 + size * cy_shift
    a = size * 0.23 * scale                      # 체크 크기

    p1 = (cx - a * 0.95, cy + a * 0.05)
    p2 = (cx - a * 0.28, cy + a * 0.70)
    p3 = (cx + a * 0.95, cy - a * 0.62)

    d.line([p1, p2, p3], fill=WHITE, width=int(w), joint="curve")
    # 선 끝을 둥글게
    for p in (p1, p3):
        r = w / 2
        d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=WHITE)


def rounded(size, radius_ratio, glyph_scale, out):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(size * radius_ratio)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=NAVY)
    check_marks(d, size, glyph_scale)
    img.save(HERE / out)
    print(f"  {out}  {size}x{size}")


print("아이콘 생성")
# 일반 아이콘 — 둥근 사각형
rounded(192, 0.22, 1.0, "icon-192.png")
rounded(512, 0.22, 1.0, "icon-512.png")

# maskable — 배경을 꽉 채우고 그림은 가운데 작게 (잘려도 안전하게)
img = Image.new("RGBA", (512, 512), NAVY)
check_marks(ImageDraw.Draw(img), 512, 0.72)
img.save(HERE / "icon-maskable-512.png")
print("  icon-maskable-512.png  512x512  (safe zone 안쪽에만 그림)")

# iOS 홈 화면 — 둥근모서리는 iOS가 알아서 깎으므로 꽉 채운다
img = Image.new("RGB", (180, 180), NAVY)
check_marks(ImageDraw.Draw(img), 180, 1.0)
img.save(HERE / "apple-touch-icon.png")
print("  apple-touch-icon.png  180x180")

# 브라우저 탭
rounded(64, 0.20, 1.05, "favicon-64.png")
print("\n완료")
