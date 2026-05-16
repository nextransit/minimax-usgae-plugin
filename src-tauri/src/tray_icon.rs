#![allow(unused)]

//! 动态图标生成模块
//! 负责: 托盘图标(3 风格) + 菜单 Icon(9 个)
//!
//! 所有图标均为运行时 RGBA 像素绘制, 无外部图片依赖。
//! 菜单 Icon 使用赛博朋克线框风格, 统一 32x32, 2px 线宽。

use tauri::image::Image;

const W32: u32 = 32;
const H32: u32 = 32;
const W16: u32 = 16;
const H16: u32 = 16;

// 状态色
const COLOR_NORMAL: (u8, u8, u8) = (0x00, 0xBF, 0xFF); // 青色
const COLOR_WARNING: (u8, u8, u8) = (0xFF, 0x8C, 0x00); // 橙色
const COLOR_CRITICAL: (u8, u8, u8) = (0xFF, 0x44, 0x44); // 红色
const COLOR_ERROR: (u8, u8, u8) = (0xFF, 0x00, 0xFF); // 品红
const COLOR_OFFLINE: (u8, u8, u8) = (0x66, 0x66, 0x66); // 灰色
const COLOR_WHITE: (u8, u8, u8) = (0xFF, 0xFF, 0xFF);

// ---- 像素操作 ----

fn set_px(buf: &mut [u8], w: u32, x: u32, y: u32, r: u8, g: u8, b: u8, a: u8) {
    if x < w && y < H32 {
        let idx = ((y * w + x) * 4) as usize;
        buf[idx] = r;
        buf[idx + 1] = g;
        buf[idx + 2] = b;
        buf[idx + 3] = a;
    }
}

/// 获取用量对应的状态色
pub fn status_color(used_percent: Option<f64>, ok: bool) -> (u8, u8, u8) {
    if !ok {
        return COLOR_ERROR;
    }
    match used_percent {
        Some(p) if p >= 90.0 => COLOR_CRITICAL,
        Some(p) if p >= 70.0 => COLOR_WARNING,
        Some(_) => COLOR_NORMAL,
        None => COLOR_OFFLINE,
    }
}

// ---- 抗锯齿圆角矩形 ----

fn rounded_rect_coverage(x: f64, y: f64, w: f64, h: f64, r: f64) -> f64 {
    let corners = [
        (r, r),
        (w - r - 1.0, r),
        (r, h - r - 1.0),
        (w - r - 1.0, h - r - 1.0),
    ];

    // 主体区域
    if x >= r && x < w - r && y >= 0.0 && y < h {
        return 1.0;
    }
    if y >= r && y < h - r && x >= 0.0 && x < w {
        return 1.0;
    }

    // 四角抗锯齿
    for (cx, cy) in corners {
        let dx = x - cx;
        let dy = y - cy;
        let dist = (dx * dx + dy * dy).sqrt();
        if dist < r - 0.5 {
            return 1.0;
        }
        if dist < r + 0.5 {
            return (r + 0.5 - dist).clamp(0.0, 1.0);
        }
    }
    0.0
}

fn fill_rounded_rect_aa(buf: &mut [u8], w: u32, h: u32, color: (u8, u8, u8), radius: f64) {
    let (cr, cg, cb) = color;
    for y in 0..h {
        for x in 0..w {
            let alpha = rounded_rect_coverage(x as f64, y as f64, w as f64, h as f64, radius);
            if alpha > 0.0 {
                let a = (alpha * 255.0).round() as u8;
                let idx = ((y * w + x) * 4) as usize;
                buf[idx] = cr;
                buf[idx + 1] = cg;
                buf[idx + 2] = cb;
                buf[idx + 3] = a;
            }
        }
    }
}

// ---- 5x7 像素字体 ----

const FONT_5X7: &[(&[u8; 7], char)] = &[
    (
        &[
            0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110,
        ],
        '0',
    ),
    (
        &[
            0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b11111,
        ],
        '1',
    ),
    (
        &[
            0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111,
        ],
        '2',
    ),
    (
        &[
            0b01110, 0b10001, 0b00001, 0b00110, 0b00001, 0b10001, 0b01110,
        ],
        '3',
    ),
    (
        &[
            0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010,
        ],
        '4',
    ),
    (
        &[
            0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110,
        ],
        '5',
    ),
    (
        &[
            0b01110, 0b10001, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110,
        ],
        '6',
    ),
    (
        &[
            0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000,
        ],
        '7',
    ),
    (
        &[
            0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110,
        ],
        '8',
    ),
    (
        &[
            0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b10001, 0b01110,
        ],
        '9',
    ),
    (
        &[
            0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001,
        ],
        'M',
    ),
    (
        &[
            0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00000, 0b00100,
        ],
        '!',
    ),
];

fn draw_char(buf: &mut [u8], w: u32, ch: u8, color: (u8, u8, u8), size: u32, ox: u32, oy: u32) {
    let glyph = FONT_5X7.iter().find(|(_, c)| *c as u8 == ch);
    if let Some((rows, _)) = glyph {
        let (cr, cg, cb) = color;
        let scale_x = size as f64 / 5.0;
        let scale_y = size as f64 / 7.0;
        for row in 0..7 {
            let bits = rows[row];
            for col in 0..5 {
                if (bits >> (4 - col)) & 1 == 1 {
                    let px = ox as f64 + col as f64 * scale_x;
                    let py = oy as f64 + row as f64 * scale_y;
                    // 2x2 oversampling for anti-aliasing
                    for sx in 0..2 {
                        for sy in 0..2 {
                            let x = (px + sx as f64 * scale_x / 2.0) as u32;
                            let y = (py + sy as f64 * scale_y / 2.0) as u32;
                            if x < w && y < H32 {
                                let idx = ((y * w + x) * 4) as usize;
                                buf[idx] = cr;
                                buf[idx + 1] = cg;
                                buf[idx + 2] = cb;
                                buf[idx + 3] = 255;
                            }
                        }
                    }
                }
            }
        }
    }
}

fn draw_number(buf: &mut [u8], w: u32, s: &str, color: (u8, u8, u8), size: u32, ox: u32, oy: u32) {
    for (i, ch) in s.chars().enumerate() {
        draw_char(
            buf,
            w,
            ch as u8,
            color,
            size,
            ox + (i as u32) * (size + 2),
            oy,
        );
    }
}

// ---- 托盘图标 (3 种风格) ----

/// default 风格: 圆角矩形 + 数字/字母
pub fn render_default_icon(used_percent: Option<f64>, ok: bool) -> Image<'static> {
    let color = status_color(used_percent, ok);
    let mut rgba = vec![0u8; (W32 * H32 * 4) as usize];

    fill_rounded_rect_aa(&mut rgba, W32, H32, color, 6.0);

    if !ok {
        draw_char(&mut rgba, W32, b'!', COLOR_WHITE, 14, 12, 4);
    } else if let Some(pct) = used_percent {
        let num = (pct.round() as u32).min(99);
        let num_str = format!("{}", num);
        let offset_x = if num < 10 { 9 } else { 2 };
        draw_number(&mut rgba, W32, &num_str, COLOR_WHITE, 13, offset_x, 5);
    } else {
        draw_char(&mut rgba, W32, b'M', COLOR_NORMAL, 16, 8, 4);
    }

    Image::new_owned(rgba, W32, H32)
}

/// minimal 风格: 16x16 实心圆
pub fn render_minimal_icon(used_percent: Option<f64>, ok: bool) -> Image<'static> {
    let color = status_color(used_percent, ok);
    let (cr, cg, cb) = color;
    let mut rgba = vec![0u8; (W16 * H16 * 4) as usize];
    let cx: f64 = 7.5;
    let cy: f64 = 7.5;
    let radius: f64 = 6.0;

    for y in 0..H16 {
        for x in 0..W16 {
            let dx = x as f64 - cx;
            let dy = y as f64 - cy;
            let dist = (dx * dx + dy * dy).sqrt();
            if dist < radius - 0.8 {
                let idx = ((y * W16 + x) * 4) as usize;
                rgba[idx] = cr;
                rgba[idx + 1] = cg;
                rgba[idx + 2] = cb;
                rgba[idx + 3] = 255;
            } else if dist < radius {
                let t = (radius - dist) / 0.8;
                let idx = ((y * W16 + x) * 4) as usize;
                rgba[idx] = (cr as f64 * t + 0x33 as f64 * (1.0 - t)) as u8;
                rgba[idx + 1] = (cg as f64 * t + 0x33 as f64 * (1.0 - t)) as u8;
                rgba[idx + 2] = (cb as f64 * t + 0x33 as f64 * (1.0 - t)) as u8;
                rgba[idx + 3] = 255;
            } else if dist < radius + 0.5 {
                let alpha = ((radius + 0.5 - dist) / 0.5 * 255.0) as u8;
                let idx = ((y * W16 + x) * 4) as usize;
                rgba[idx] = 0x33;
                rgba[idx + 1] = 0x33;
                rgba[idx + 2] = 0x33;
                rgba[idx + 3] = alpha;
            }
        }
    }

    Image::new_owned(rgba, W16, H16)
}

/// gauge 风格: 32x32 进度环
pub fn render_gauge_icon(used_percent: Option<f64>, ok: bool) -> Image<'static> {
    let color = status_color(used_percent, ok);
    let (cr, cg, cb) = color;
    let pct = used_percent.unwrap_or(0.0).min(100.0) / 100.0;
    let mut rgba = vec![0u8; (W32 * H32 * 4) as usize];
    let cx: f64 = 15.5;
    let cy: f64 = 15.5;
    let radius: f64 = 13.0;
    let thickness: f64 = 4.0;
    let inner_r = radius - thickness;

    use std::f64::consts::PI;
    let start_angle = -PI / 2.0;

    for y in 0..H32 {
        for x in 0..W32 {
            let dx = x as f64 - cx;
            let dy = y as f64 - cy;
            let dist = (dx * dx + dy * dy).sqrt();
            let angle = dy.atan2(dx);
            let mut norm_angle = if angle < start_angle {
                angle + 2.0 * PI
            } else {
                angle
            };
            // 将角度映射为从顶部顺时针
            let progress_angle = (norm_angle - start_angle) % (2.0 * PI);

            if dist >= inner_r && dist <= radius {
                let idx = ((y * W32 + x) * 4) as usize;
                if progress_angle <= 2.0 * PI * pct {
                    rgba[idx] = cr;
                    rgba[idx + 1] = cg;
                    rgba[idx + 2] = cb;
                    rgba[idx + 3] = 255;
                } else {
                    rgba[idx] = 0x33;
                    rgba[idx + 1] = 0x33;
                    rgba[idx + 2] = 0x33;
                    rgba[idx + 3] = 255;
                }
            }

            // 内外边缘抗锯齿
            if dist > inner_r - 1.0 && dist < inner_r && dist < radius {
                let alpha = ((dist - inner_r + 1.0) * 255.0) as u8;
                let idx = ((y * W32 + x) * 4) as usize;
                if rgba[idx + 3] == 0 {
                    rgba[idx] = 0x33;
                    rgba[idx + 1] = 0x33;
                    rgba[idx + 2] = 0x33;
                    rgba[idx + 3] = alpha;
                }
            }
            if dist > radius && dist < radius + 1.0 && dist > inner_r {
                let alpha = ((radius + 1.0 - dist) * 255.0) as u8;
                let idx = ((y * W32 + x) * 4) as usize;
                if rgba[idx + 3] == 0 {
                    rgba[idx] = 0x33;
                    rgba[idx + 1] = 0x33;
                    rgba[idx + 2] = 0x33;
                    rgba[idx + 3] = alpha;
                }
            }
        }
    }

    Image::new_owned(rgba, W32, H32)
}

/// 根据风格和用量数据生成托盘图标
pub fn render_tray_icon(style: &str, used_percent: Option<f64>, ok: bool) -> Image<'static> {
    match style {
        "minimal" => render_minimal_icon(used_percent, ok),
        "gauge" => render_gauge_icon(used_percent, ok),
        _ => render_default_icon(used_percent, ok),
    }
}

// ---- 线框绘制辅助 ----

fn draw_line(
    buf: &mut [u8],
    (x0, y0): (i32, i32),
    (x1, y1): (i32, i32),
    color: (u8, u8, u8),
    thickness: i32,
) {
    let (cr, cg, cb) = color;
    let dx = (x1 - x0).abs();
    let dy = -(y1 - y0).abs();
    let sx = if x0 < x1 { 1 } else { -1 };
    let sy = if y0 < y1 { 1 } else { -1 };
    let mut err = dx + dy;
    let (mut x, mut y) = (x0, y0);
    loop {
        // 粗线: 以当前像素为中心画一个 thickness x thickness 方块
        for dy2 in -thickness / 2..=thickness / 2 {
            for dx2 in -thickness / 2..=thickness / 2 {
                let px = (x + dx2) as u32;
                let py = (y + dy2) as u32;
                if px < W32 && py < H32 {
                    let idx = ((py * W32 + px) * 4) as usize;
                    buf[idx] = cr;
                    buf[idx + 1] = cg;
                    buf[idx + 2] = cb;
                    buf[idx + 3] = 255;
                }
            }
        }
        if x == x1 && y == y1 {
            break;
        }
        let e2 = 2 * err;
        if e2 >= dy {
            err += dy;
            x += sx;
        }
        if e2 <= dx {
            err += dx;
            y += sy;
        }
    }
}

fn fill_circle_icon(buf: &mut [u8], cx: i32, cy: i32, r: i32, color: (u8, u8, u8)) {
    let (cr, cg, cb) = color;
    for y in (cy - r).max(0)..=(cy + r).min(H32 as i32 - 1) {
        for x in (cx - r).max(0)..=(cx + r).min(W32 as i32 - 1) {
            let dx = x - cx;
            let dy = y - cy;
            if dx * dx + dy * dy <= r * r {
                let idx = ((y as u32 * W32 + x as u32) * 4) as usize;
                buf[idx] = cr;
                buf[idx + 1] = cg;
                buf[idx + 2] = cb;
                buf[idx + 3] = 255;
            }
        }
    }
}

fn tiny_dot(buf: &mut [u8], x: i32, y: i32, color: (u8, u8, u8)) {
    for dy in -1..=1 {
        for dx in -1..=1 {
            let px = (x + dx) as u32;
            let py = (y + dy) as u32;
            if px < W32 && py < H32 {
                let idx = ((py * W32 + px) * 4) as usize;
                buf[idx] = color.0;
                buf[idx + 1] = color.1;
                buf[idx + 2] = color.2;
                buf[idx + 3] = 255;
            }
        }
    }
}

// ---- 9 个菜单 Icon ----

/// 模型: 神经网络拓扑 (3 节点三角 + 连线 + 中心发光点)
pub fn render_menu_icon_model() -> Image<'static> {
    let mut buf = vec![0u8; (W32 * H32 * 4) as usize];
    let c = COLOR_NORMAL;
    fill_circle_icon(&mut buf, 16, 5, 3, c);
    fill_circle_icon(&mut buf, 4, 25, 3, c);
    fill_circle_icon(&mut buf, 28, 25, 3, c);
    draw_line(&mut buf, (16, 5), (4, 25), c, 2);
    draw_line(&mut buf, (16, 5), (28, 25), c, 2);
    draw_line(&mut buf, (4, 25), (28, 25), c, 2);
    fill_circle_icon(&mut buf, 16, 18, 2, COLOR_WHITE);
    Image::new_owned(buf, W32, H32)
}

/// 周期: 脉冲波形
pub fn render_menu_icon_period() -> Image<'static> {
    let mut buf = vec![0u8; (W32 * H32 * 4) as usize];
    let c = COLOR_NORMAL;
    let pts = [(3, 24), (9, 7), (15, 24), (21, 7), (27, 24)];
    for i in 0..pts.len() - 1 {
        draw_line(&mut buf, pts[i], pts[i + 1], c, 2);
    }
    // 顶部发光点
    for (x, y) in [(9, 7), (21, 7)] {
        tiny_dot(&mut buf, x, y, COLOR_WHITE);
    }
    Image::new_owned(buf, W32, H32)
}

/// 剩余: 能量柱
pub fn render_menu_icon_balance() -> Image<'static> {
    let mut buf = vec![0u8; (W32 * H32 * 4) as usize];
    let c = COLOR_NORMAL;
    // 三条柱: (x_center, top, bottom)
    let bars = [(8, 8, 24), (16, 14, 24), (24, 4, 24)];
    for (bx, top, bottom) in bars {
        for y in top..bottom {
            for dx in -2..=2 {
                let px = (bx + dx) as u32;
                if px < W32 {
                    let idx = ((y as u32 * W32 + px) * 4) as usize;
                    buf[idx] = c.0;
                    buf[idx + 1] = c.1;
                    buf[idx + 2] = c.2;
                    buf[idx + 3] = 255;
                }
            }
        }
        // 柱顶发光横线
        for dx in -3..=3 {
            let px = (bx + dx) as u32;
            if px < W32 && top > 0 {
                let idx = ((top as u32 * W32 + px) * 4) as usize;
                buf[idx] = COLOR_WHITE.0;
                buf[idx + 1] = COLOR_WHITE.1;
                buf[idx + 2] = COLOR_WHITE.2;
                buf[idx + 3] = 200;
            }
        }
    }
    Image::new_owned(buf, W32, H32)
}

/// 本周: 数据面板刻度条 (7 条竖线 = 一周)
pub fn render_menu_icon_calendar() -> Image<'static> {
    let mut buf = vec![0u8; (W32 * H32 * 4) as usize];
    let c = COLOR_NORMAL;
    for i in 0..7 {
        let x = 3 + i * 4;
        let h = if i < 3 { 10 + i * 3 } else { 18 - i * 2 };
        draw_line(&mut buf, (x, 28), (x, 28 - h), c, 2);
        tiny_dot(&mut buf, x, 28 - h, COLOR_WHITE);
    }
    draw_line(&mut buf, (2, 28), (29, 28), (0x44, 0x44, 0x44), 1);
    Image::new_owned(buf, W32, H32)
}

/// 刷新: 双箭头循环
pub fn render_menu_icon_refresh() -> Image<'static> {
    let mut buf = vec![0u8; (W32 * H32 * 4) as usize];
    let c = COLOR_NORMAL;
    use std::f64::consts::PI;
    let cx: f64 = 16.0;
    let cy: f64 = 16.0;
    let r: f64 = 10.0;
    // 上弧 (顺时针, 左侧到右上)
    for deg in (0..250).step_by(4) {
        let rad = ((deg as f64 - 125.0) * PI / 180.0);
        let x = (cx + r * rad.cos()) as u32;
        let y = (cy + r * rad.sin() - 3.0) as u32;
        if x < W32 && y < H32 {
            let idx = ((y * W32 + x) * 4) as usize;
            buf[idx] = c.0;
            buf[idx + 1] = c.1;
            buf[idx + 2] = c.2;
            buf[idx + 3] = 255;
        }
    }
    // 下弧 (顺时针, 右侧到左下)
    for deg in (0..250).step_by(4) {
        let rad = ((deg as f64 + 55.0) * PI / 180.0);
        let x = (cx + r * rad.cos()) as u32;
        let y = (cy + r * rad.sin() + 3.0) as u32;
        if x < W32 && y < H32 {
            let idx = ((y * W32 + x) * 4) as usize;
            buf[idx] = c.0;
            buf[idx + 1] = c.1;
            buf[idx + 2] = c.2;
            buf[idx + 3] = 255;
        }
    }
    // 箭头尖
    fill_circle_icon(&mut buf, 26, 7, 2, COLOR_WHITE);
    fill_circle_icon(&mut buf, 6, 25, 2, COLOR_WHITE);
    Image::new_owned(buf, W32, H32)
}

/// 显示比例: HUD 半圆弧刻度盘
pub fn render_menu_icon_scale() -> Image<'static> {
    let mut buf = vec![0u8; (W32 * H32 * 4) as usize];
    let c = COLOR_NORMAL;
    use std::f64::consts::PI;
    let cx: f64 = 16.0;
    let cy: f64 = 18.0;
    // 半圆弧刻度 (30° ~ 150°)
    for deg in (30..=150).step_by(6) {
        let rad = deg as f64 * PI / 180.0;
        let inner_r = 9.0;
        let outer_r = if deg % 30 == 0 { 13.0 } else { 11.0 };
        let color = if deg % 30 == 0 { COLOR_WHITE } else { c };
        let x1 = (cx + inner_r * rad.cos()) as i32;
        let y1 = (cy - inner_r * rad.sin()) as i32;
        let x2 = (cx + outer_r * rad.cos()) as i32;
        let y2 = (cy - outer_r * rad.sin()) as i32;
        draw_line(&mut buf, (x1, y1), (x2, y2), color, 2);
    }
    // 指针 (指向约 60%)
    draw_line(&mut buf, (16, 18), (23, 5), COLOR_WHITE, 2);
    fill_circle_icon(&mut buf, 16, 18, 2, c);
    Image::new_owned(buf, W32, H32)
}

/// 设置 Key: 芯片/认证卡
pub fn render_menu_icon_key_set() -> Image<'static> {
    let mut buf = vec![0u8; (W32 * H32 * 4) as usize];
    let c = COLOR_NORMAL;
    // 卡片边框
    draw_line(&mut buf, (5, 4), (26, 4), c, 2);
    draw_line(&mut buf, (5, 4), (5, 27), c, 2);
    draw_line(&mut buf, (26, 4), (26, 27), c, 2);
    draw_line(&mut buf, (5, 27), (26, 27), c, 2);
    // 芯片核心
    fill_circle_icon(&mut buf, 16, 16, 5, c);
    fill_circle_icon(&mut buf, 16, 16, 2, COLOR_WHITE);
    // 芯片引脚
    for i in 0..3 {
        let x = 8 + i * 8;
        draw_line(&mut buf, (x, 0), (x + 2, 3), c, 2);
        draw_line(&mut buf, (x, 28), (x + 2, 31), c, 2);
    }
    Image::new_owned(buf, W32, H32)
}

/// 清除 Key: Glitch 消除符号 (X + 偏移碎片)
pub fn render_menu_icon_key_clear() -> Image<'static> {
    let mut buf = vec![0u8; (W32 * H32 * 4) as usize];
    let c = COLOR_WARNING;
    // 主 X
    draw_line(&mut buf, (6, 5), (25, 26), c, 2);
    draw_line(&mut buf, (25, 5), (6, 26), c, 2);
    // Glitch 碎片
    for i in 0..3 {
        let gx = 10 + i * 3;
        let gy = 14 + i * 2;
        for dx in 0..3 {
            let alpha = 255 - dx * 80;
            let px = (gx + dx) as u32;
            let py = gy as u32;
            if px < W32 && py < H32 {
                let idx = ((py * W32 + px) * 4) as usize;
                buf[idx] = c.0;
                buf[idx + 1] = c.1;
                buf[idx + 2] = c.2;
                buf[idx + 3] = alpha;
            }
        }
    }
    Image::new_owned(buf, W32, H32)
}

/// 退出: 电源/切断开关 (断开圆 + 竖线)
pub fn render_menu_icon_exit() -> Image<'static> {
    let mut buf = vec![0u8; (W32 * H32 * 4) as usize];
    let c = COLOR_CRITICAL;
    use std::f64::consts::PI;
    let cx: f64 = 16.0;
    let cy: f64 = 17.0;
    let r: f64 = 10.0;
    // 断开的圆 (从 60° 到 300°, 留出顶部缺口)
    for deg in (60..=300).step_by(3) {
        let rad = (deg as f64 * PI / 180.0);
        let x = (cx + r * rad.cos()) as u32;
        let y = (cy + r * rad.sin()) as u32;
        if x < W32 && y < H32 {
            // 2px 粗弧线
            for dy in 0..=1 {
                for dx in 0..=1 {
                    let px = x + dx;
                    let py = y + dy;
                    if px < W32 && py < H32 {
                        let idx = ((py * W32 + px) * 4) as usize;
                        buf[idx] = c.0;
                        buf[idx + 1] = c.1;
                        buf[idx + 2] = c.2;
                        buf[idx + 3] = 255;
                    }
                }
            }
        }
    }
    // 竖线 (电源符号的竖杠)
    draw_line(&mut buf, (16, 3), (16, 14), c, 2);
    // 顶部发光点
    fill_circle_icon(&mut buf, 16, 3, 2, COLOR_WHITE);
    Image::new_owned(buf, W32, H32)
}

/// 根据 menu id 返回对应的菜单 Icon
pub fn render_menu_icon(menu_id: &str) -> Option<Image<'static>> {
    match menu_id {
        "model" => Some(render_menu_icon_model()),
        "interval" => Some(render_menu_icon_period()),
        "remaining" => Some(render_menu_icon_balance()),
        "weekly_remaining" => Some(render_menu_icon_calendar()),
        "refresh" => Some(render_menu_icon_refresh()),
        "toggle_show_percent" => Some(render_menu_icon_scale()),
        "set_key" => Some(render_menu_icon_key_set()),
        "clear_key" => Some(render_menu_icon_key_clear()),
        "quit" => Some(render_menu_icon_exit()),
        _ => None,
    }
}
