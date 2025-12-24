# 🍌 Nano Banana User Manual

Welcome to the complete guide for using the Nano Banana Photoshop Plugin.

## Table of Contents
1.  [Interface Overview](#interface-overview)
2.  [Generating Images](#generating-images)
3.  [Refining Prompts](#refining-prompts)
4.  [Context Settings](#context-settings)
5.  [Using Reference Images](#using-reference-images)
6.  [Presets & History](#presets--history)

---

## Interface Overview

The Nano Banana interface is designed to be clean and integrated with Photoshop. It consists of the Prompt Area, Action Buttons, Context Settings, and Footer.

<!-- PLACEHOLDER: Annotated screenshot of the full interface -->
<!-- ![Full Interface Overview](path/to/overview.png) -->

---

## Generating Images

### 1. Enter a Prompt
Type your description into the main text box. Be descriptive!
*   *Example: "A futuristic city with neon lights, cyberpunk style, rainy night"*

### 2. Choose Variations
Use the number counter (next to the Generate button) to select how many images you want to generate at once (1 to 8).
*   *Tip: Generating 4 variations is executed in parallel and allows you to pick the best composition.*

### 3. Click Generate
Hit the **"Generate"** button. A loading spinner will appear.
Once finished, the images will be added to your Photoshop document as new layers.

<!-- PLACEHOLDER: Screenshot of the Prompt inputs and Generate button -->
<!-- ![Prompt and Generate Section](path/to/generate_section.png) -->

---

## Refining Prompts

Struggling to find the right words? Let Gemini help.

1.  **Type a basic idea**: e.g., "Cat in space".
2.  **Select a Model**: Use the dropdown next to the "Refine prompt" button to choose which Gemini model to use (e.g., Gemini 1.5 Pro, Gemini 1.5 Flash).
3.  **Click "Refine prompt"**: The plugin will rewrite your prompt into a detailed, artistic description optimized for image generation.

<!-- PLACEHOLDER: Screenshot of the Refine Prompt button and result -->
<!-- ![Refine Prompt Feature](path/to/refine_feature.png) -->

---

## Context Settings

Expand the **Context Settings** section to control how the image is generated relative to your canvas.

*   **Use Foreground Color**: Forces the AI to incorporate your currently selected Photoshop foreground color into the color palette of the image.
*   **Use only selected layer(s)**: Uses the active layer content as a base or context for the new generation (Image-to-Image).
*   **Use exact dimensions**: Generates the image at the exact pixel dimensions of your current selection or canvas (Note: this may impact generation speed or quality if dimensions are extreme).
*   **Upscale (BETA)**: Increases the resolution of the final output. Select a factor (e.g., 2x, 4x).

<!-- PLACEHOLDER: Screenshot of the Context Settings panel -->
<!-- ![Context Settings](path/to/context_settings.png) -->

---

## Using Reference Images

You can guide the style or composition using your own images.

1.  Open **Context Settings**.
2.  Click **"Browse"** next to Reference Image.
3.  Select a file (JPG, PNG) from your computer.
4.  A thumbnail will appear. The AI will now use this image as visual inspiration.

<!-- PLACEHOLDER: Screenshot of the Reference Image uploader -->
<!-- ![Reference Image UI](path/to/reference_image.png) -->

---

## Presets & History

### Presets
Save your favorite prompts to reuse them later.
1.  Expand **Presets**.
2.  Click **"Create New"**.
3.  Enter a Name and the Prompt content.
4.  Click Save. You can now click on any preset to instantly load it.

### History
The plugin remembers your last 20 generations.
1.  Expand **History**.
2.  Scroll through past prompts.
3.  Click **"Use This"** to restore the prompt and settings from that session.

<!-- PLACEHOLDER: Screenshot of Presets and History sections -->
<!-- ![Presets and History](path/to/history_presets.png) -->
