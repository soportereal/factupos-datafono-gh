#!/usr/bin/env python3
"""
Genera los iconos del tray de FactuposDatafono.

CLAVE: las entradas chicas (16/24/32/48) DEBEN ir en formato BMP/DIB, no PNG.
El systray de Windows NO renderiza entradas PNG en tamaños pequeños -> se ve en
blanco. Por eso `bitmap_format="bmp"`. (Bug histórico del icono invisible.)

Salidas:
  tray-activo.ico    / tray-inactivo.ico   -> compactos (16-48), se embeben en src/tray-iconos.js
  datafono.ico                             -> completo (16-256) para el instalador/.exe/accesos

Regenerar el módulo embebido tras correr esto:
  node -e '...'  (ver README) o volver a correr el paso que escribe src/tray-iconos.js
"""
from PIL import Image, ImageDraw
import shutil

SMALL = [16, 24, 32, 48]
FULL = [16, 24, 32, 48, 256]


def make_icon(dot_rgb, dim=False):
    """Tarjeta de pago (chip + banda) con un punto de estado grande."""
    S = 256
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if dim:
        card, band = (100, 116, 139, 255), (71, 85, 105, 255)   # gris = caído
    else:
        card, band = (37, 99, 235, 255), (30, 64, 150, 255)     # azul = activo
    m = 26
    d.rounded_rectangle([m, m + 18, S - m, S - m - 18], radius=28, fill=card)
    d.rectangle([m, 92, S - m, 130], fill=band)                 # banda magnética
    d.rounded_rectangle([m + 16, 150, m + 70, 196], radius=8, fill=(226, 232, 240, 255))  # chip
    r = 54
    cx, cy = S - 58, S - 58
    d.ellipse([cx - r - 6, cy - r - 6, cx + r + 6, cy + r + 6], fill=(15, 23, 42, 255))    # borde
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=dot_rgb)   # punto de estado
    return img


def save_ico(dot_rgb, dim, path, sizes):
    make_icon(dot_rgb, dim).save(path, format="ICO",
                                 sizes=[(s, s) for s in sizes], bitmap_format="bmp")


if __name__ == "__main__":
    save_ico((34, 197, 94, 255), False, "tray-activo.ico", SMALL)     # verde
    save_ico((239, 68, 68, 255), True, "tray-inactivo.ico", SMALL)    # rojo
    save_ico((34, 197, 94, 255), False, "datafono.ico", FULL)         # instalador/.exe
    print("Iconos generados: tray-activo.ico, tray-inactivo.ico, datafono.ico")
