# Design Language

## Overview
This design language embraces a **modern, minimal, and refined aesthetic** built around clarity, balance, and contrast. It uses a dark foundation contrasted with soft neutrals and vibrant highlights to communicate focus, depth, and sophistication. The style is clean, UI-agnostic, and suitable for both digital and physical product design systems.

---

## Color

### **Base Palette**
- **Primary Background:** Deep neutral tones (charcoal, navy black, or graphite gray)
- **Secondary Background:** Slightly lighter variants for depth separation
- **Surfaces:** Semi-transparent or elevated layers to create dimensional hierarchy
- **Accent Colors:** Neon-inspired hues — purples, teals, oranges, or yellows for visual signals and highlights
- **Neutral Texts:** White and soft gray for balance and readability
- **Support Colors:** Soft reds (alerts), greens (success), and blues (information)

### **Usage**
- Maintain high contrast for accessibility
- Apply accent colors sparingly to highlight interactivity or importance
- Use subtle gradients or glow effects for emphasis, not decoration

---

## Typography

### **Primary Typeface**
- *Inter*, *Poppins*, or any geometric sans-serif for clarity and modernity  
- Rounded letterforms for a friendly, accessible tone

### **Style Guide**
- **Headers:** Bold, clean, and spacious — act as anchors within layouts  
- **Subheaders:** Medium weight, secondary level navigation or emphasis  
- **Body Text:** Neutral, legible, and slightly smaller than default system text  
- **Labels & Metadata:** Lightweight, spaced, and designed for quick scanning  

### **Text Color Hierarchy**
1. Primary Text: Pure white or near-white for high visibility  
2. Secondary Text: Muted gray for less emphasis  
3. Tertiary Text: Faded or translucent gray for context or inactive states  

---

## Shape and Form

- **Corners:** Rounded (8–12px radius) for contemporary, friendly visuals  
- **Containers:** Modular and flexible—stackable elements maintaining consistent spacing  
- **Dividers:** Thin lines or subtle color shifts to define separation  
- **Shadows:** Soft and diffused; mimic elevation and layering in dark UI  

---

## Layout

- **Grid System:** 8px baseline grid  
- **Padding:** Generous spacing around visual components  
- **Alignment:** Predominantly left-aligned for readability; centered balance for dashboards or summaries  
- **Composition:** Minimal clutter—group related content with clear boundaries and breathing space  

---

## Iconography

- **Style:** Linear or outlined icons, 24px base size  
- **Consistency:** Uniform stroke width across all icons  
- **Interaction Cue:** Change in color or slight glow on hover or active  

---

## Motion & Interaction

- **Transition Speed:** 200–300ms for smooth yet responsive feedback  
- **Easing:** Use natural cubic-bezier curves or simple linear-ease for UI transitions  
- **Microinteractions:** Subtle animations on hover, active state, or data refresh  
- **Focus Effects:** Soft pulsing glow or highlight shift—avoid harsh transitions  

---

## Visual Tone

- **Mood:** Calm, deliberate, and confident  
- **Lighting:** Low-intensity gradients, ambient backgrounds  
- **Texture:** Matte over gloss — soft contrasts and continuous surfaces  
- **Energy:** Technology-forward yet human-centered  

---

## Favored Characteristics

Preferences applied in sidebar and list UIs:

### **Scroll & viewport**
- **No visible scrollbars** — content may scroll (e.g. mouse wheel, touch) but scrollbars are hidden for a clean edge.
- **Fixed-height containers** — sidebars or panels use a fixed viewport height; only the content area scrolls inside that frame so the chrome never scrolls.

### **List bullets**
- **Bullets sit next to the title** — indented from the app edge (e.g. 8px list padding), with modest padding between bullet and text (e.g. 14px) so bullets are clearly paired with their line, not hugging the edge.
- **Bullets stay with the first line** — when a title wraps to multiple lines, the bullet is aligned to the first line only (e.g. `top: 0.5em`), not vertically centered on the whole block.
- **Primary list bullets** (Meetings, Tasks, Projects): same size and placement across sections — 6px circle, aligned to first line; accent color by section (e.g. teal / green / amber).
- **Sub-item bullets** (meeting action items, project task items): same treatment in both — small **grey dot** (4px circle, tertiary text color) and identical spacing (list 14px left, item 12px left, 1px vertical) so sub-lists feel consistent.

### **Density**
- **Compact spacing** where a full day’s content must fit — tighter padding and margins (e.g. 8px grid), slightly smaller type (e.g. 11px) and line-height so more items fit without feeling cramped.

---

## Overall Feel

This design language blends the precision of a **professional interface** with the warmth of **humanized digital aesthetics**. It balances darkness and vibrancy, structure and playfulness, creating a visual rhythm focused on clarity, emotion, and usability.

---
