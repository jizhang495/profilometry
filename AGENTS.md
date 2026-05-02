# Agent Requirements

This file outlines the original instructions given to the agent for building this profilometry data analyzer.

## Goal
Write code in the `profilometry/` directory to analyze profilometry data of the cross-section of printed metal/PEDOT:PSS lines.

## Specific Requirements
- **Data Input:** Parse CSV files from Dektak surface profilometry.
- **Plotting:** Plot the loaded graph data from the CSV.
- **Peak Identification:** Identify the peak of interest. The system should allow human judgment to determine where the peak is via a user interface.
- **Background Subtraction:** Remove the background. Note that the background is Kapton tape and not flat, requiring standard base-lining (e.g. polynomial fitting/subtraction).
- **Metric Extraction:** 
  1. Determine the Full Width at Half Maximum (FWHM) of the printed lines.
  2. Determine the cross-sectional area of the printed metal/PEDOT:PSS lines (integral of the subtracted peak).
- **User Interface:** Construct a simple Tkinter interface allowing the user to check/identify the peak visually and perform the background fitting interactively.
- **Package Management:** Utilize `uv` for minimal constraint python package management.
- **Documentation:** Provide a `README.md` detailing how to use the codebase.
- **Requirement Tracking:** Create an `AGENTS.md` explicitly defining these requirements.

## Additional Requirements
- **Web Application:** Add a browser-based implementation of the analyzer while keeping the Python/Tkinter implementation intact.
- **Implementation Parity:** The web application should support CSV/folder loading, visual peak selection, background fitting/subtraction, FWHM and cross-sectional area extraction, saved result rows, CSV export, and plot export.
