const state = {
  files: [],
  currentIndex: -1,
  currentName: "",
  fullX: [],
  fullY: [],
  x: [],
  y: [],
  peakRegion: null,
  averageRegion: null,
  metrics: null,
  results: []
};

const els = {};

const plotConfig = {
  responsive: true,
  displaylogo: false,
  modeBarButtonsToRemove: ["lasso2d", "autoScale2d"]
};

let rawSelectionHandlerBound = false;
let corrSelectionHandlerBound = false;

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  bindEvents();
  renderEmptyPlots();
  renderResults();
});

function cacheElements() {
  [
    "fileInput",
    "folderInput",
    "fileLabel",
    "prevBtn",
    "nextBtn",
    "saveSvgBtn",
    "bgOrder",
    "splineS",
    "dataMin",
    "dataMax",
    "applyRangeBtn",
    "resetRangeBtn",
    "autoFindBtn",
    "denoise",
    "cutoff",
    "exclMin",
    "exclMax",
    "peakMin",
    "peakMax",
    "applyPeakBtn",
    "heightMetric",
    "fwhmMetric",
    "areaMetric",
    "averageMetric",
    "status",
    "rawPlot",
    "corrPlot",
    "addResultBtn",
    "appendAverageBtn",
    "resultsBody",
    "deleteSelectedBtn",
    "clearResultsBtn",
    "exportCsvBtn"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  els.fileInput.addEventListener("change", (event) => {
    loadFileList(Array.from(event.target.files || []));
    event.target.value = "";
  });

  els.folderInput.addEventListener("change", (event) => {
    loadFileList(Array.from(event.target.files || []));
    event.target.value = "";
  });

  els.prevBtn.addEventListener("click", () => {
    if (state.currentIndex > 0) {
      loadCurrentFile(state.currentIndex - 1);
    }
  });

  els.nextBtn.addEventListener("click", () => {
    if (state.currentIndex < state.files.length - 1) {
      loadCurrentFile(state.currentIndex + 1);
    }
  });

  els.saveSvgBtn.addEventListener("click", saveCurrentSvgs);
  els.applyRangeBtn.addEventListener("click", () => applyDataLimits(false));
  els.resetRangeBtn.addEventListener("click", resetDataLimits);
  els.autoFindBtn.addEventListener("click", autoFindPeak);
  els.applyPeakBtn.addEventListener("click", applyManualPeak);
  els.addResultBtn.addEventListener("click", addCurrentResult);
  els.appendAverageBtn.addEventListener("click", appendAverageHeight);
  els.deleteSelectedBtn.addEventListener("click", deleteSelectedResults);
  els.clearResultsBtn.addEventListener("click", clearResults);
  els.exportCsvBtn.addEventListener("click", exportResultsCsv);

  [
    els.bgOrder,
    els.splineS,
    els.denoise,
    els.cutoff,
    els.exclMin,
    els.exclMax
  ].forEach((control) => {
    control.addEventListener("change", processData);
    control.addEventListener("input", debounce(processData, 180));
  });
}

function loadFileList(files) {
  const csvFiles = files
    .filter((file) => /\.csv$/i.test(file.name))
    .sort((a, b) => displayFileName(a).localeCompare(displayFileName(b)));

  if (!csvFiles.length) {
    setStatus("No CSV files selected.", "warn");
    return;
  }

  state.files = csvFiles;
  loadCurrentFile(0);
}

async function loadCurrentFile(index) {
  const file = state.files[index];
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const parsed = parseDektakCsv(text, displayFileName(file));

    state.currentIndex = index;
    state.currentName = displayFileName(file);
    state.fullX = parsed.x;
    state.fullY = parsed.y;
    state.peakRegion = null;
    state.averageRegion = null;
    state.metrics = null;

    updateFileLabel();
    updateNav();
    applyDataLimits(true);
    setStatus(`Loaded ${state.currentName}. Drag across the top plot or enter peak limits.`, "");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function parseDektakCsv(text, filename) {
  const rows = parseCsvRows(text);
  let headerIndex = -1;
  let xIndex = -1;
  let yIndex = -1;

  for (let i = 0; i < rows.length; i += 1) {
    const columns = rows[i].map(normalizeHeader);
    const maybeX = columns.findIndex((header) => {
      return header.includes("lateral") && (
        header.includes("um") ||
        header.includes("micron") ||
        header.includes("\u00b5m") ||
        header.includes("\u03bcm")
      );
    });
    const maybeY = columns.findIndex((header) => header.includes("total profile"));

    if (maybeX !== -1 && maybeY !== -1) {
      headerIndex = i;
      xIndex = maybeX;
      yIndex = maybeY;
      break;
    }
  }

  if (headerIndex === -1) {
    throw new Error(`Could not find Dektak data headers in ${filename}.`);
  }

  const x = [];
  const y = [];

  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i];
    const xVal = parseNumeric(row[xIndex]);
    const yVal = parseNumeric(row[yIndex]);

    if (Number.isFinite(xVal) && Number.isFinite(yVal)) {
      x.push(xVal);
      y.push(yVal / 10000.0);
    }
  }

  if (x.length < 3) {
    throw new Error(`No usable profilometry rows found in ${filename}.`);
  }

  return { x, y };
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === "\"") {
        if (text[i + 1] === "\"") {
          field += "\"";
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === "\"") {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char === "\r") {
      if (text[i + 1] !== "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      }
    } else {
      field += char;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/µ/g, "\u00b5")
    .replace(/μ/g, "\u00b5");
}

function parseNumeric(value) {
  if (value === undefined || value === null) {
    return NaN;
  }

  const cleaned = String(value)
    .trim()
    .replace(/\s+/g, "")
    .replace(/,/g, "");

  if (!cleaned) {
    return NaN;
  }

  return Number(cleaned);
}

function applyDataLimits(resetPeak) {
  if (!state.fullX.length) {
    return;
  }

  const min = readOptionalNumber(els.dataMin);
  const max = readOptionalNumber(els.dataMax);

  if (min !== null && max !== null && min >= max) {
    setStatus("Data min must be less than data max.", "error");
    return;
  }

  const x = [];
  const y = [];

  for (let i = 0; i < state.fullX.length; i += 1) {
    const xVal = state.fullX[i];
    if ((min === null || xVal >= min) && (max === null || xVal <= max)) {
      x.push(xVal);
      y.push(state.fullY[i]);
    }
  }

  if (!x.length) {
    setStatus("Data range is empty.", "error");
    return;
  }

  state.x = x;
  state.y = y;

  if (resetPeak) {
    state.peakRegion = null;
    state.averageRegion = null;
    clearPeakInputs();
  } else if (state.peakRegion) {
    const clipped = [
      Math.max(state.peakRegion[0], x[0]),
      Math.min(state.peakRegion[1], x[x.length - 1])
    ];
    state.peakRegion = clipped[0] < clipped[1] ? clipped : null;
    if (!state.peakRegion) {
      state.averageRegion = null;
    }
    updatePeakInputs();
  }

  if (state.peakRegion) {
    processData();
  } else {
    state.metrics = null;
    renderMetrics();
    renderInitialPlots();
  }

  updateButtons();
}

function resetDataLimits() {
  els.dataMin.value = "";
  els.dataMax.value = "";
  els.exclMin.value = "";
  els.exclMax.value = "";
  applyDataLimits(false);
}

function applyManualPeak() {
  const min = readOptionalNumber(els.peakMin);
  const max = readOptionalNumber(els.peakMax);

  if (min === null || max === null || min >= max) {
    setStatus("Peak min must be less than peak max.", "error");
    return;
  }

  setPeakRegion(min, max);
}

function setPeakRegion(x0, x1) {
  if (!state.x.length) {
    return;
  }

  const min = Math.max(Math.min(x0, x1), state.x[0]);
  const max = Math.min(Math.max(x0, x1), state.x[state.x.length - 1]);

  if (min >= max) {
    setStatus("Selected peak region is outside the active data range.", "error");
    return;
  }

  state.peakRegion = [min, max];
  updatePeakInputs();
  processData();
}

function setAverageRegion(x0, x1) {
  if (!state.metrics || !state.metrics.xPeak.length) {
    setStatus("Select a peak region before measuring average height.", "warn");
    return;
  }

  const min = Math.max(Math.min(x0, x1), state.metrics.xPeak[0]);
  const max = Math.min(Math.max(x0, x1), state.metrics.xPeak[state.metrics.xPeak.length - 1]);

  if (min >= max) {
    setStatus("Average-height region is outside the corrected plot range.", "error");
    return;
  }

  state.averageRegion = [min, max];
  processData();
}

function processData() {
  if (!state.x.length || !state.y.length || !state.peakRegion) {
    return;
  }

  const [xmin, xmax] = state.peakRegion;
  const peakMask = state.x.map((xVal) => xVal >= xmin && xVal <= xmax);
  let bgMask = peakMask.map((selected) => !selected);
  const exclMin = readOptionalNumber(els.exclMin);
  const exclMax = readOptionalNumber(els.exclMax);
  const hasExclusion = exclMin !== null && exclMax !== null && exclMin < exclMax;

  if (hasExclusion) {
    bgMask = bgMask.map((include, i) => {
      const xVal = state.x[i];
      return include && !(xVal >= exclMin && xVal <= exclMax);
    });
  }

  const bgCount = bgMask.reduce((total, include) => total + (include ? 1 : 0), 0);
  if (bgCount < 2) {
    setStatus("Not enough background points outside the peak region.", "error");
    return;
  }

  const yForBg = els.denoise.checked
    ? denoiseBackground(state.x, state.y, xmin, xmax)
    : state.y.slice();

  const xBg = [];
  const yBg = [];
  for (let i = 0; i < state.x.length; i += 1) {
    if (bgMask[i]) {
      xBg.push(state.x[i]);
      yBg.push(yForBg[i]);
    }
  }

  let fit;
  let fitLabel;
  try {
    if (els.bgOrder.value === "Spline") {
      fit = makeSplineFit(xBg, yBg, readOptionalNumber(els.splineS));
      fitLabel = "Spline";
    } else {
      const order = Math.max(0, Math.min(6, Number(els.bgOrder.value) || 0));
      fit = makePolynomialFit(xBg, yBg, order);
      fitLabel = `Order ${order}`;
    }
  } catch (error) {
    setStatus(error.message, "error");
    return;
  }

  const bgFit = state.x.map((xVal) => fit(xVal));
  const yCorr = state.y.map((yVal, i) => yVal - bgFit[i]);
  const peakData = extractPeakData(state.x, yCorr, peakMask);
  const metrics = calculateMetrics(peakData.x, peakData.y);
  const averageSelection = state.averageRegion
    ? calculateRegionAverage(peakData.x, peakData.y, state.averageRegion[0], state.averageRegion[1])
    : null;

  if (state.averageRegion && !averageSelection) {
    state.averageRegion = null;
  } else if (averageSelection) {
    state.averageRegion = averageSelection.region;
  }

  state.metrics = {
    ...metrics,
    xPeak: peakData.x,
    yPeak: peakData.y,
    averageRegion: averageSelection ? averageSelection.region : null,
    averageHeight: averageSelection ? averageSelection.average : null,
    yCorr,
    bgFit,
    yForBg,
    fitLabel,
    exclusion: hasExclusion ? [exclMin, exclMax] : null
  };

  renderMetrics();
  renderAnalysisPlots();
  updateButtons();
  setStatus("Analysis updated.", "");
}

function denoiseBackground(x, y, xmin, xmax) {
  const smoothed = y.slice();
  const dx = meanSpacing(x);
  const cutoff = readOptionalNumber(els.cutoff);

  if (!Number.isFinite(dx) || dx <= 0 || cutoff === null || cutoff <= 0) {
    return smoothed;
  }

  const windowSize = Math.max(3, Math.round(cutoff / dx));
  const leftEnd = lastIndexBefore(x, xmin);
  const rightStart = firstIndexAfter(x, xmax);

  if (leftEnd >= 15) {
    replaceSegmentWithSmooth(smoothed, 0, leftEnd, windowSize);
  }

  if (rightStart !== -1 && y.length - rightStart > 15) {
    replaceSegmentWithSmooth(smoothed, rightStart, y.length - 1, windowSize);
  }

  return smoothed;
}

function replaceSegmentWithSmooth(values, start, end, windowSize) {
  const segment = values.slice(start, end + 1);
  const smooth = movingAverage(segment, windowSize);
  for (let i = 0; i < smooth.length; i += 1) {
    values[start + i] = smooth[i];
  }
}

function movingAverage(values, windowSize) {
  const window = Math.min(
    values.length,
    Math.max(3, windowSize % 2 === 0 ? windowSize + 1 : windowSize)
  );
  const half = Math.floor(window / 2);
  const prefix = [0];

  for (let i = 0; i < values.length; i += 1) {
    prefix.push(prefix[i] + values[i]);
  }

  return values.map((_, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(values.length - 1, i + half);
    return (prefix[hi + 1] - prefix[lo]) / (hi - lo + 1);
  });
}

function makePolynomialFit(x, y, requestedDegree) {
  const points = x.length;
  const degree = Math.min(requestedDegree, points - 1);

  if (degree < 0) {
    throw new Error("Not enough points for polynomial fit.");
  }

  if (degree === 0) {
    const avg = y.reduce((sum, val) => sum + val, 0) / y.length;
    return () => avg;
  }

  const min = Math.min(...x);
  const max = Math.max(...x);
  const center = (min + max) / 2;
  const scale = max === min ? 1 : (max - min) / 2;
  const xs = x.map((xVal) => (xVal - center) / scale);
  const powers = Array(2 * degree + 1).fill(0);

  for (const xVal of xs) {
    let p = 1;
    for (let i = 0; i < powers.length; i += 1) {
      powers[i] += p;
      p *= xVal;
    }
  }

  const matrix = [];
  const rhs = [];
  for (let row = 0; row <= degree; row += 1) {
    matrix[row] = [];
    for (let col = 0; col <= degree; col += 1) {
      matrix[row][col] = powers[row + col];
    }

    rhs[row] = 0;
    for (let i = 0; i < xs.length; i += 1) {
      rhs[row] += y[i] * Math.pow(xs[i], row);
    }
  }

  const coeffs = solveLinearSystem(matrix, rhs);
  if (!coeffs) {
    throw new Error("Polynomial background fit failed.");
  }

  return (xVal) => {
    const normalized = (xVal - center) / scale;
    let total = 0;
    let p = 1;
    for (const coeff of coeffs) {
      total += coeff * p;
      p *= normalized;
    }
    return total;
  };
}

function solveLinearSystem(matrix, rhs) {
  const n = rhs.length;
  const augmented = matrix.map((row, i) => row.slice().concat(rhs[i]));

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[pivot][col])) {
        pivot = row;
      }
    }

    if (Math.abs(augmented[pivot][col]) < 1e-12) {
      return null;
    }

    if (pivot !== col) {
      [augmented[col], augmented[pivot]] = [augmented[pivot], augmented[col]];
    }

    const pivotValue = augmented[col][col];
    for (let c = col; c <= n; c += 1) {
      augmented[col][c] /= pivotValue;
    }

    for (let row = 0; row < n; row += 1) {
      if (row === col) {
        continue;
      }
      const factor = augmented[row][col];
      for (let c = col; c <= n; c += 1) {
        augmented[row][c] -= factor * augmented[col][c];
      }
    }
  }

  return augmented.map((row) => row[n]);
}

function makeSplineFit(x, y, smoothingValue) {
  const sorted = x.map((xVal, i) => ({ x: xVal, y: y[i] }))
    .sort((a, b) => a.x - b.x);
  const uniqueX = [];
  const uniqueY = [];

  for (const point of sorted) {
    const last = uniqueX.length - 1;
    if (last >= 0 && point.x === uniqueX[last]) {
      uniqueY[last] = (uniqueY[last] + point.y) / 2;
    } else {
      uniqueX.push(point.x);
      uniqueY.push(point.y);
    }
  }

  if (uniqueX.length < 4) {
    return makePolynomialFit(x, y, 1);
  }

  const reduced = reduceKnots(uniqueX, uniqueY, 900);
  let knotY = reduced.y;

  if (smoothingValue !== null && smoothingValue > 0) {
    const dx = meanSpacing(reduced.x);
    const windowSize = Number.isFinite(dx) && dx > 0
      ? Math.max(3, Math.round(smoothingValue / dx))
      : Math.max(3, Math.round(smoothingValue));
    knotY = movingAverage(knotY, Math.min(windowSize, Math.floor(knotY.length / 3) || 3));
  }

  return buildNaturalCubicSpline(reduced.x, knotY);
}

function reduceKnots(x, y, maxKnots) {
  if (x.length <= maxKnots) {
    return { x: x.slice(), y: y.slice() };
  }

  const step = Math.ceil(x.length / maxKnots);
  const reducedX = [];
  const reducedY = [];

  for (let i = 0; i < x.length; i += step) {
    const end = Math.min(x.length, i + step);
    let xSum = 0;
    let ySum = 0;
    for (let j = i; j < end; j += 1) {
      xSum += x[j];
      ySum += y[j];
    }
    reducedX.push(xSum / (end - i));
    reducedY.push(ySum / (end - i));
  }

  return { x: reducedX, y: reducedY };
}

function buildNaturalCubicSpline(x, y) {
  const n = x.length;
  const a = y.slice();
  const b = Array(n - 1).fill(0);
  const d = Array(n - 1).fill(0);
  const h = Array(n - 1).fill(0);

  for (let i = 0; i < n - 1; i += 1) {
    h[i] = x[i + 1] - x[i];
    if (h[i] <= 0) {
      throw new Error("Spline background fit requires increasing x data.");
    }
  }

  const alpha = Array(n).fill(0);
  for (let i = 1; i < n - 1; i += 1) {
    alpha[i] = (3 / h[i]) * (a[i + 1] - a[i]) - (3 / h[i - 1]) * (a[i] - a[i - 1]);
  }

  const c = Array(n).fill(0);
  const l = Array(n).fill(0);
  const mu = Array(n).fill(0);
  const z = Array(n).fill(0);
  l[0] = 1;

  for (let i = 1; i < n - 1; i += 1) {
    l[i] = 2 * (x[i + 1] - x[i - 1]) - h[i - 1] * mu[i - 1];
    if (Math.abs(l[i]) < 1e-12) {
      throw new Error("Spline background fit failed.");
    }
    mu[i] = h[i] / l[i];
    z[i] = (alpha[i] - h[i - 1] * z[i - 1]) / l[i];
  }

  l[n - 1] = 1;

  for (let j = n - 2; j >= 0; j -= 1) {
    c[j] = z[j] - mu[j] * c[j + 1];
    b[j] = (a[j + 1] - a[j]) / h[j] - h[j] * (c[j + 1] + 2 * c[j]) / 3;
    d[j] = (c[j + 1] - c[j]) / (3 * h[j]);
  }

  return (xVal) => {
    const i = findSplineInterval(x, xVal);
    const dx = xVal - x[i];
    return a[i] + b[i] * dx + c[i] * dx * dx + d[i] * dx * dx * dx;
  };
}

function findSplineInterval(x, value) {
  if (value <= x[0]) {
    return 0;
  }

  if (value >= x[x.length - 1]) {
    return x.length - 2;
  }

  let lo = 0;
  let hi = x.length - 2;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (value < x[mid]) {
      hi = mid - 1;
    } else if (value > x[mid + 1]) {
      lo = mid + 1;
    } else {
      return mid;
    }
  }

  return Math.max(0, Math.min(x.length - 2, lo));
}

function extractPeakData(x, yCorr, peakMask) {
  const xPeak = [];
  const yPeak = [];

  for (let i = 0; i < x.length; i += 1) {
    if (peakMask[i]) {
      xPeak.push(x[i]);
      yPeak.push(yCorr[i]);
    }
  }

  return { x: xPeak, y: yPeak };
}

function calculateMetrics(xPeak, yPeak) {
  if (!xPeak.length || !yPeak.length) {
    return {
      height: null,
      fwhm: null,
      area: null,
      targetHeight: null,
      leftHalf: null,
      rightHalf: null,
      blobX: [],
      blobY: []
    };
  }

  let maxIdx = 0;
  for (let i = 1; i < yPeak.length; i += 1) {
    if (yPeak[i] > yPeak[maxIdx]) {
      maxIdx = i;
    }
  }

  const height = yPeak[maxIdx];
  const baseFloor = Math.max(0, height * 0.02);
  let leftBlob = maxIdx;
  let rightBlob = maxIdx;

  while (leftBlob > 0 && yPeak[leftBlob - 1] > baseFloor) {
    leftBlob -= 1;
  }

  while (rightBlob < yPeak.length - 1 && yPeak[rightBlob + 1] > baseFloor) {
    rightBlob += 1;
  }

  const blobX = xPeak.slice(leftBlob, rightBlob + 1);
  const blobY = yPeak.slice(leftBlob, rightBlob + 1);
  const targetHeight = height * 0.5;
  const aboveHalf = [];

  for (let i = 0; i < blobY.length; i += 1) {
    if (blobY[i] >= targetHeight) {
      aboveHalf.push(i);
    }
  }

  let fwhm = null;
  let leftHalf = null;
  let rightHalf = null;

  if (aboveHalf.length) {
    const first = aboveHalf[0];
    const last = aboveHalf[aboveHalf.length - 1];

    if (first > 0) {
      leftHalf = interpolateCrossing(
        blobX[first - 1],
        blobY[first - 1],
        blobX[first],
        blobY[first],
        targetHeight
      );
    } else {
      leftHalf = blobX[0];
    }

    if (last < blobX.length - 1) {
      rightHalf = interpolateCrossing(
        blobX[last],
        blobY[last],
        blobX[last + 1],
        blobY[last + 1],
        targetHeight
      );
    } else {
      rightHalf = blobX[blobX.length - 1];
    }

    fwhm = rightHalf - leftHalf;
  }

  const area = blobX.length > 1 ? trapezoid(blobX, blobY) : 0;

  return {
    height,
    fwhm,
    area,
    targetHeight,
    leftHalf,
    rightHalf,
    blobX,
    blobY
  };
}

function interpolateCrossing(x1, y1, x2, y2, target) {
  if (y2 === y1) {
    return x1;
  }
  return x1 + (target - y1) * (x2 - x1) / (y2 - y1);
}

function trapezoid(x, y) {
  let area = 0;
  for (let i = 1; i < x.length; i += 1) {
    area += 0.5 * (y[i] + y[i - 1]) * (x[i] - x[i - 1]);
  }
  return area;
}

function calculateRegionAverage(x, y, x0, x1) {
  if (!x.length || !y.length) {
    return null;
  }

  const min = Math.max(Math.min(x0, x1), x[0]);
  const max = Math.min(Math.max(x0, x1), x[x.length - 1]);
  if (min >= max) {
    return null;
  }

  const regionX = [min];
  for (const xVal of x) {
    if (xVal > min && xVal < max) {
      regionX.push(xVal);
    }
  }
  regionX.push(max);

  const regionY = regionX.map((xVal) => interpolateLineValue(x, y, xVal));
  const average = trapezoid(regionX, regionY) / (max - min);
  return {
    region: [min, max],
    average
  };
}

function interpolateLineValue(x, y, value) {
  if (value <= x[0]) {
    return y[0];
  }

  const last = x.length - 1;
  if (value >= x[last]) {
    return y[last];
  }

  for (let i = 1; i < x.length; i += 1) {
    if (x[i] >= value) {
      const x0 = x[i - 1];
      const x1 = x[i];
      const y0 = y[i - 1];
      const y1 = y[i];
      if (x1 === x0) {
        return y0;
      }
      return y0 + (value - x0) * (y1 - y0) / (x1 - x0);
    }
  }

  return y[last];
}

function autoFindPeak() {
  if (!state.x.length || !state.y.length) {
    return;
  }

  let linear;
  try {
    linear = makePolynomialFit(state.x, state.y, 1);
  } catch {
    setStatus("Auto-find failed while estimating the background.", "error");
    return;
  }

  const corrected = state.x.map((xVal, i) => state.y[i] - linear(xVal));
  const maxVal = Math.max(...corrected);

  if (!Number.isFinite(maxVal) || maxVal <= 0) {
    setStatus("Could not automatically identify a positive peak.", "warn");
    return;
  }

  const threshold = maxVal * 0.5;
  let peakIdx = -1;

  for (let i = 1; i < corrected.length - 1; i += 1) {
    const isPeak = corrected[i] > corrected[i - 1] && corrected[i] >= corrected[i + 1];
    if (isPeak && corrected[i] >= threshold && (peakIdx === -1 || corrected[i] > corrected[peakIdx])) {
      peakIdx = i;
    }
  }

  if (peakIdx === -1) {
    peakIdx = corrected.indexOf(maxVal);
  }

  const baseThreshold = maxVal * 0.05;
  let left = peakIdx;
  let right = peakIdx;

  while (left > 0 && corrected[left - 1] > baseThreshold) {
    left -= 1;
  }

  while (right < corrected.length - 1 && corrected[right + 1] > baseThreshold) {
    right += 1;
  }

  let maskWidth = (state.x[right] - state.x[left]) * 2;
  const totalWidth = state.x[state.x.length - 1] - state.x[0];

  if (!Number.isFinite(maskWidth) || maskWidth <= 0) {
    maskWidth = totalWidth * 0.15;
  }

  const peakX = state.x[peakIdx];
  setPeakRegion(
    Math.max(state.x[0], peakX - maskWidth / 2),
    Math.min(state.x[state.x.length - 1], peakX + maskWidth / 2)
  );
}

function renderEmptyPlots() {
  const layout = makePlotLayout("Raw Profilometry Data", "Lateral (\u03bcm)", "Profile (\u03bcm)", "select");
  Plotly.newPlot(els.rawPlot, [], layout, plotConfig);
  Plotly.newPlot(
    els.corrPlot,
    [],
    makePlotLayout("Background Subtracted Data", "Lateral (\u03bcm)", "Profile (\u03bcm)", "select"),
    plotConfig
  );
  bindRawSelectionHandler();
  bindCorrSelectionHandler();
}

function renderInitialPlots() {
  const rawTrace = {
    x: state.x,
    y: state.y,
    type: "scatter",
    mode: "lines",
    line: { color: "#1f77b4", width: 2 },
    name: "Raw Data"
  };

  Plotly.react(
    els.rawPlot,
    [rawTrace],
    makePlotLayout("Raw Profilometry Data", "Lateral (\u03bcm)", "Profile (\u03bcm)", "select"),
    plotConfig
  );
  Plotly.react(
    els.corrPlot,
    [],
    makePlotLayout("Background Subtracted Data", "Lateral (\u03bcm)", "Profile (\u03bcm)", "select"),
    plotConfig
  );
  bindRawSelectionHandler();
  bindCorrSelectionHandler();
}

function renderAnalysisPlots() {
  const metrics = state.metrics;
  if (!metrics) {
    renderInitialPlots();
    return;
  }

  const traces = [
    {
      x: state.x,
      y: state.y,
      type: "scatter",
      mode: "lines",
      line: { color: "#1f77b4", width: 2 },
      name: "Raw Data"
    }
  ];

  if (els.denoise.checked && !arraysNearlyEqual(metrics.yForBg, state.y)) {
    const denoised = metrics.yForBg.map((value, i) => {
      const xVal = state.x[i];
      const inPeak = xVal >= state.peakRegion[0] && xVal <= state.peakRegion[1];
      return inPeak ? null : value;
    });
    traces.push({
      x: state.x,
      y: denoised,
      type: "scatter",
      mode: "lines",
      line: { color: "#238b45", width: 2 },
      connectgaps: false,
      name: "Denoised BG"
    });
  }

  traces.push({
    x: state.x,
    y: metrics.bgFit,
    type: "scatter",
    mode: "lines",
    line: { color: "#d9822b", width: 2, dash: "dash" },
    name: `BG Fit (${metrics.fitLabel})`
  });

  const rawLayout = makePlotLayout("Raw Data & Background Fit", "Lateral (\u03bcm)", "Profile (\u03bcm)", "select");
  rawLayout.shapes = peakAndExclusionShapes(metrics.exclusion);

  Plotly.react(els.rawPlot, traces, rawLayout, plotConfig);
  bindRawSelectionHandler();

  const corrTraces = [
    {
      x: metrics.xPeak,
      y: metrics.yPeak,
      type: "scatter",
      mode: "lines",
      line: { color: "#2ca02c", width: 2 },
      name: "Subtracted Peak"
    }
  ];

  if (metrics.blobX.length > 1) {
    corrTraces.push({
      x: metrics.blobX,
      y: metrics.blobY,
      type: "scatter",
      mode: "lines",
      fill: "tozeroy",
      line: { color: "rgba(184, 134, 11, 0.15)", width: 1 },
      fillcolor: "rgba(245, 185, 65, 0.32)",
      name: "Integrated Area"
    });
  }

  const corrLayout = makePlotLayout("Background Subtracted Data", "Lateral (\u03bcm)", "Profile (\u03bcm)", "select");
  corrLayout.shapes = [];

  if (metrics.fwhm !== null) {
    corrLayout.shapes.push({
      type: "line",
      xref: "x",
      yref: "y",
      x0: metrics.leftHalf,
      x1: metrics.rightHalf,
      y0: metrics.targetHeight,
      y1: metrics.targetHeight,
      line: { color: "#a020a0", width: 3 }
    });
    corrLayout.annotations = [{
      x: (metrics.leftHalf + metrics.rightHalf) / 2,
      y: metrics.targetHeight,
      text: `FWHM: ${formatNumber(metrics.fwhm)} \u03bcm`,
      showarrow: false,
      yshift: 16,
      bgcolor: "rgba(255,255,255,0.85)",
      bordercolor: "#d7dedb",
      borderwidth: 1,
      font: { size: 12 }
    }];
  }

  if (metrics.area !== null) {
    corrLayout.annotations = (corrLayout.annotations || []).concat({
      xref: "paper",
      yref: "paper",
      x: 0.02,
      y: 0.95,
      text: `Area: ${formatNumber(metrics.area)} \u03bcm\u00b2`,
      showarrow: false,
      align: "left",
      bgcolor: "rgba(255,255,255,0.85)",
      bordercolor: "#d7dedb",
      borderwidth: 1,
      font: { size: 12 }
    });
  }

  if (metrics.averageRegion && Number.isFinite(metrics.averageHeight)) {
    const [avgMin, avgMax] = metrics.averageRegion;
    corrLayout.shapes.push({
      type: "rect",
      xref: "x",
      yref: "paper",
      x0: avgMin,
      x1: avgMax,
      y0: 0,
      y1: 1,
      fillcolor: "rgba(14, 165, 233, 0.14)",
      line: { width: 0 },
      layer: "below"
    });
    corrLayout.shapes.push({
      type: "line",
      xref: "x",
      yref: "y",
      x0: avgMin,
      x1: avgMax,
      y0: metrics.averageHeight,
      y1: metrics.averageHeight,
      line: { color: "#0284c7", width: 3, dash: "dash" }
    });
    corrLayout.annotations = (corrLayout.annotations || []).concat({
      x: (avgMin + avgMax) / 2,
      y: metrics.averageHeight,
      text: `Average height: ${formatNumber(metrics.averageHeight)} \u03bcm`,
      showarrow: false,
      yshift: 28,
      bgcolor: "rgba(255,255,255,0.68)",
      bordercolor: "#d7dedb",
      borderwidth: 1,
      font: { size: 12 }
    });
  }

  Plotly.react(els.corrPlot, corrTraces, corrLayout, plotConfig);
  bindCorrSelectionHandler();
}

function peakAndExclusionShapes(exclusion) {
  const shapes = [];

  if (state.peakRegion) {
    shapes.push({
      type: "rect",
      xref: "x",
      yref: "paper",
      x0: state.peakRegion[0],
      x1: state.peakRegion[1],
      y0: 0,
      y1: 1,
      fillcolor: "rgba(190, 24, 93, 0.13)",
      line: { width: 0 },
      layer: "below"
    });
  }

  if (exclusion) {
    shapes.push({
      type: "rect",
      xref: "x",
      yref: "paper",
      x0: exclusion[0],
      x1: exclusion[1],
      y0: 0,
      y1: 1,
      fillcolor: "rgba(107, 114, 128, 0.20)",
      line: { width: 0 },
      layer: "below"
    });
  }

  return shapes;
}

function makePlotLayout(title, xTitle, yTitle, dragmode) {
  return {
    title: { text: title, font: { size: 16 } },
    margin: { l: 62, r: 24, t: 48, b: 52 },
    paper_bgcolor: "#fbfcfc",
    plot_bgcolor: "#fbfcfc",
    hovermode: "closest",
    dragmode,
    selectdirection: dragmode === "select" ? "h" : "any",
    uirevision: state.currentName || "empty",
    xaxis: {
      title: xTitle,
      zeroline: false,
      showgrid: true,
      gridcolor: "#e8eeeb"
    },
    yaxis: {
      title: yTitle,
      zeroline: true,
      zerolinecolor: "#c8d3cf",
      showgrid: true,
      gridcolor: "#e8eeeb"
    },
    legend: {
      orientation: "h",
      y: 1.12,
      x: 1,
      xanchor: "right"
    }
  };
}

function bindRawSelectionHandler() {
  if (rawSelectionHandlerBound || !els.rawPlot || !els.rawPlot.on) {
    return;
  }

  els.rawPlot.on("plotly_selected", (event) => {
    let range = event && event.range && event.range.x;

    if (!range && event && event.points && event.points.length) {
      const xs = event.points.map((point) => point.x);
      range = [Math.min(...xs), Math.max(...xs)];
    }

    if (range && range.length === 2 && range[0] !== range[1]) {
      setPeakRegion(range[0], range[1]);
    }
  });

  rawSelectionHandlerBound = true;
}

function bindCorrSelectionHandler() {
  if (corrSelectionHandlerBound || !els.corrPlot || !els.corrPlot.on) {
    return;
  }

  els.corrPlot.on("plotly_selected", (event) => {
    let range = event && event.range && event.range.x;

    if (!range && event && event.points && event.points.length) {
      const xs = event.points.map((point) => point.x);
      range = [Math.min(...xs), Math.max(...xs)];
    }

    if (range && range.length === 2 && range[0] !== range[1]) {
      setAverageRegion(range[0], range[1]);
    }
  });

  corrSelectionHandlerBound = true;
}

function renderMetrics() {
  const metrics = state.metrics;

  els.heightMetric.textContent = metrics && metrics.height !== null
    ? `${formatNumber(metrics.height)} \u03bcm`
    : "N/A";
  els.fwhmMetric.textContent = metrics && metrics.fwhm !== null
    ? `${formatNumber(metrics.fwhm)} \u03bcm`
    : "N/A";
  els.areaMetric.textContent = metrics && metrics.area !== null
    ? `${formatNumber(metrics.area)} \u03bcm\u00b2`
    : "N/A";
  els.averageMetric.textContent = metrics && Number.isFinite(metrics.averageHeight)
    ? `${formatNumber(metrics.averageHeight)} \u03bcm`
    : "N/A";
}

function addCurrentResult() {
  if (!state.metrics || !state.currentName) {
    return;
  }

  state.results.push({
    selected: false,
    filename: stripExtension(baseFileName(state.currentName)),
    height: state.metrics.height,
    fwhm: state.metrics.fwhm,
    area: state.metrics.area,
    averageHeights: Array(5).fill(null)
  });
  renderResults();
}

function appendAverageHeight() {
  const result = state.results[state.results.length - 1];
  if (!result || !Number.isFinite(state.metrics?.averageHeight)) {
    setStatus("Add Data and select an average-height region on the bottom graph first.", "warn");
    return;
  }
  const slot = result.averageHeights.indexOf(null);
  if (slot === -1) {
    setStatus("The latest row already has five average-height measurements.", "warn");
    return;
  }
  result.averageHeights[slot] = state.metrics.averageHeight;
  renderResults();
  setStatus(`Saved h${slot + 1} to ${result.filename}.`, "");
}

function renderResults() {
  els.resultsBody.innerHTML = "";

  if (!state.results.length) {
    const row = document.createElement("tr");
    row.className = "empty-row";
    row.innerHTML = "<td colspan=\"10\">No saved results</td>";
    els.resultsBody.appendChild(row);
  } else {
    state.results.forEach((result, index) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td><input type="checkbox" data-index="${index}" ${result.selected ? "checked" : ""}></td>
        <td>${escapeHtml(result.filename)}</td>
        <td>${formatCell(result.height)}</td>
        <td>${formatCell(result.fwhm)}</td>
        <td>${formatCell(result.area)}</td>
        ${result.averageHeights.map((value) => `<td>${value === null ? "" : formatCell(value)}</td>`).join("")}
      `;
      els.resultsBody.appendChild(row);
    });
  }

  els.resultsBody.querySelectorAll("input[type=\"checkbox\"]").forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      const index = Number(event.target.dataset.index);
      state.results[index].selected = event.target.checked;
      updateResultsButtons();
    });
  });

  updateResultsButtons();
}

function deleteSelectedResults() {
  state.results = state.results.filter((result) => !result.selected);
  renderResults();
}

function clearResults() {
  state.results = [];
  renderResults();
}

function exportResultsCsv() {
  if (!state.results.length) {
    return;
  }

  const rows = [
    ["Filename", "Height", "FWHM", "Area", "h1", "h2", "h3", "h4", "h5"],
    ...state.results.map((result) => [
      result.filename,
      formatCell(result.height),
      formatCell(result.fwhm),
      formatCell(result.area),
      ...result.averageHeights.map((value) => value === null ? "" : formatCell(value))
    ])
  ];
  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  downloadBlob("profilometry_results.csv", csv, "text/csv;charset=utf-8");
}

async function saveCurrentSvgs() {
  if (!state.currentName) {
    return;
  }

  try {
    const base = stripExtension(baseFileName(state.currentName));
    const rawWidth = 1100;
    const rawHeight = 620;
    const corrWidth = 1100;
    const corrHeight = 520;
    const rawSvg = await Plotly.toImage(els.rawPlot, {
      format: "svg",
      width: rawWidth,
      height: rawHeight
    });
    const corrSvg = await Plotly.toImage(els.corrPlot, {
      format: "svg",
      width: corrWidth,
      height: corrHeight
    });
    const totalHeight = rawHeight + corrHeight + 24;
    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${rawWidth}" height="${totalHeight}" viewBox="0 0 ${rawWidth} ${totalHeight}">`,
      `<image href="${escapeHtml(rawSvg)}" xlink:href="${escapeHtml(rawSvg)}" x="0" y="0" width="${rawWidth}" height="${rawHeight}"/>`,
      `<image href="${escapeHtml(corrSvg)}" xlink:href="${escapeHtml(corrSvg)}" x="0" y="${rawHeight + 24}" width="${corrWidth}" height="${corrHeight}"/>`,
      "</svg>"
    ].join("");
    downloadBlob(`${base}-plots.svg`, svg, "image/svg+xml;charset=utf-8");
  } catch (error) {
    setStatus(`Could not export SVG: ${error.message}`, "error");
  }
}

function updateFileLabel() {
  if (!state.currentName) {
    els.fileLabel.textContent = "No file loaded";
    return;
  }

  els.fileLabel.textContent = `[${state.currentIndex + 1}/${state.files.length}] ${state.currentName}`;
}

function updateNav() {
  els.prevBtn.disabled = state.currentIndex <= 0;
  els.nextBtn.disabled = state.currentIndex < 0 || state.currentIndex >= state.files.length - 1;
}

function updateButtons() {
  const hasData = state.x.length > 0;
  const hasMetrics = Boolean(state.metrics);

  els.autoFindBtn.disabled = !hasData;
  els.applyPeakBtn.disabled = !hasData;
  els.saveSvgBtn.disabled = !hasData;
  els.addResultBtn.disabled = !hasMetrics;
  updateResultsButtons();
}

function updateResultsButtons() {
  const hasResults = state.results.length > 0;
  const hasSelected = state.results.some((result) => result.selected);

  const latestResult = state.results[state.results.length - 1];
  els.appendAverageBtn.disabled = !latestResult
    || !Number.isFinite(state.metrics?.averageHeight)
    || !latestResult.averageHeights.includes(null);
  els.deleteSelectedBtn.disabled = !hasSelected;
  els.clearResultsBtn.disabled = !hasResults;
  els.exportCsvBtn.disabled = !hasResults;
}

function updatePeakInputs() {
  if (!state.peakRegion) {
    clearPeakInputs();
    return;
  }

  els.peakMin.value = roundInputValue(state.peakRegion[0]);
  els.peakMax.value = roundInputValue(state.peakRegion[1]);
}

function clearPeakInputs() {
  els.peakMin.value = "";
  els.peakMax.value = "";
}

function setStatus(message, tone) {
  els.status.textContent = message || "";
  els.status.className = `status${tone ? ` ${tone}` : ""}`;
}

function readOptionalNumber(input) {
  const value = input.value.trim();
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function meanSpacing(x) {
  if (x.length < 2) {
    return NaN;
  }

  let total = 0;
  let count = 0;
  for (let i = 1; i < x.length; i += 1) {
    const diff = x[i] - x[i - 1];
    if (diff > 0) {
      total += diff;
      count += 1;
    }
  }

  return count ? total / count : NaN;
}

function lastIndexBefore(x, value) {
  for (let i = x.length - 1; i >= 0; i -= 1) {
    if (x[i] < value) {
      return i;
    }
  }
  return -1;
}

function firstIndexAfter(x, value) {
  for (let i = 0; i < x.length; i += 1) {
    if (x[i] > value) {
      return i;
    }
  }
  return -1;
}

function arraysNearlyEqual(a, b) {
  if (a.length !== b.length) {
    return false;
  }

  for (let i = 0; i < a.length; i += 1) {
    if (Math.abs(a[i] - b[i]) > 1e-12) {
      return false;
    }
  }

  return true;
}

function formatNumber(value) {
  return Number.isFinite(value) ? value.toFixed(4) : "N/A";
}

function formatCell(value) {
  return Number.isFinite(value) ? value.toFixed(4) : "N/A";
}

function roundInputValue(value) {
  return Number.isFinite(value) ? String(Number(value.toFixed(6))) : "";
}

function displayFileName(file) {
  return file.webkitRelativePath || file.name;
}

function baseFileName(path) {
  return String(path).split(/[\\/]/).pop();
}

function stripExtension(filename) {
  return filename.replace(/\.[^.]+$/, "");
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function downloadBlob(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
}
