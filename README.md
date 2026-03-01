# Profilometry Data Analyzer

This script is designed to process profilometry data (specifically surface scans from a Dektak or similar instrument) of printed metal/PEDOT:PSS lines. Since these lines are typically printed on flexible Kapton substrates, the substrate often has curvature or unevenness requiring a background subtraction.

## Features

- **CSV Parsing:** Automatically handles and loads data starting from the correct offset lines for typical profiling exports.
- **Interactive Background Subtraction:** Utilizing a Tkinter & Matplotlib GUI to let the user visually select the peak area of interest. Any data *outside* the selected area is used to calculate and fit a polynomial background.
- **FWHM Calculation:** Computes the Full Width at Half Maximum to describe the width of the printed line.
- **Cross-Sectional Area:** Numerically integrates the background-subtracted peak.

## Prerequisites & Installation

This project utilizes `uv` for minimal and extremely fast package caching and management.

1. Install `uv` if not already installed (e.g., using `pip install uv`, via `curl -LsSf https://astral.sh/uv/install.sh | sh`, or any other method in uv's documentable guides).

2. Clone this repository (or download the script directly).

3. Setup environment and install dependencies:
   ```bash
   uv sync
   ```
   Or explicitly install the libraries via:
   ```bash
   uv add pandas matplotlib numpy scipy
   ```

## Usage

You can run the application directly inside the managed environment via:
```bash
uv run main.py
```

**Auto-Start Scripts:**
If you have already installed `uv`, you can simply run the provided shortcut scripts to automatically start the application without opening a terminal:
- **Windows User:** Double-click `run.bat`
- **macOS/Linux User:** Execute `./run.sh`

### In the Application:
1. Click **"Load Folder"** or **"Load CSV File"** to browse and select your profilometry data. You can navigate quickly using '< Prev' and 'Next >'.
2. The Top Graph will plot the loaded Raw Data.
3. Click **"Auto-Find"** to intelligently identify and highlight the main printing peak. Alternatively, left-click and drag across the peak you wish to measure manually. A red span selector will highlight the active region.
4. The background will be automatically fitted using the non-highlighted areas (meaning the substrate regions to the left and right of the peak). 
5. Under **"BG Fit"**, you can select `0` (flat), `1` (linear slope), `2`, `3`, etc., or `Spline` depending on how curved your kapton tape is locally. If using `Spline`, you can provide a custom smoothing factor `s`.
6. Use **Data min/max** to visually truncate the matrix to a region of interest, or **Exclude BG min/max** to specifically ignore segments of data from background fitting calculations (plotted in gray).
7. Enable **Denoise BG** to run a preliminary low pass filter against high spatial frequency variations before polynomial fitting.
8. The Bottom Graph updates specifically with the subtracted peak.
9. Click **Add Data** to save the active peak's measurements to the tracking table. You can mass export this to CSV clicking **Export CSV**.


## TODOs
- [ ] Allow saving project files to remember individual settings of csv files, batch saving results.
- [x] Smart peak auto identification.
- [ ] Try Anchor Point (Manual Knot) Fitting, Asymmetric Least Squares (Auto-Baselining)