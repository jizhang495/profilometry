import os
import sys
import glob
import tkinter as tk
from tkinter import filedialog, ttk, messagebox
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg, NavigationToolbar2Tk
from matplotlib.widgets import SpanSelector
from scipy.signal import butter, filtfilt, find_peaks, peak_widths
from scipy.interpolate import UnivariateSpline

def load_data(filepath):
    try:
        header_row = None
        with open(filepath, 'r', encoding='utf-8') as f:
            for i, line in enumerate(f):
                if 'Lateral(µm)' in line and 'Total Profile(Å)' in line:
                    header_row = i
                    break
        if header_row is None:
            raise ValueError(f"Could not find data headers in {filepath}")
        df = pd.read_csv(filepath, skiprows=header_row)
        df = df.dropna(axis=1, how='all')
        x = df['Lateral(µm)'].values
        y = df['Total Profile(Å)'].values / 10000.0
        mask = ~np.isnan(x) & ~np.isnan(y)
        return x[mask], y[mask]
    except Exception as e:
        messagebox.showerror("Error Loading Data", str(e))
        return None, None

def calculate_area(x, y):
    return np.trapezoid(y, x)

class ProfilometryApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Profilometry Data Analyzer")
        self.geometry("1400x850")
        self.protocol("WM_DELETE_WINDOW", self.on_closing)
        
        self.x_full = None
        self.y_full = None
        self.x = None
        self.y = None
        self.filepath = None
        self.csv_files = []
        self.current_idx = 0
        self.peak_region = [None, None]
        
        self.current_height = None
        self.current_fwhm = None
        self.current_area = None
        
        self.setup_ui()
        
    def on_closing(self):
        self.quit()
        self.destroy()
        sys.exit(0)

    def setup_ui(self):
        main_paned = ttk.PanedWindow(self, orient=tk.HORIZONTAL)
        main_paned.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)
        
        left_frame = ttk.Frame(main_paned)
        right_frame = ttk.Frame(main_paned)
        
        main_paned.add(left_frame, weight=3)
        main_paned.add(right_frame, weight=1)
        
        # --- Left Frame (Controls and Plots) ---
        top_frame = ttk.Frame(left_frame)
        top_frame.pack(side=tk.TOP, fill=tk.X, padx=5, pady=5)
        
        row1 = ttk.Frame(top_frame)
        row1.pack(side=tk.TOP, fill=tk.X, pady=2)
        
        ttk.Button(row1, text="Load CSV File", command=self.load_file).pack(side=tk.LEFT, padx=2)
        ttk.Button(row1, text="Load Folder", command=self.load_folder).pack(side=tk.LEFT, padx=2)
        ttk.Button(row1, text="< Prev", command=self.prev_file).pack(side=tk.LEFT, padx=2)
        ttk.Button(row1, text="Next >", command=self.next_file).pack(side=tk.LEFT, padx=2)
        ttk.Button(row1, text="Save SVG", command=self.save_svg).pack(side=tk.LEFT, padx=(20, 2))
        
        self.file_label = ttk.Label(row1, text="No file loaded")
        self.file_label.pack(side=tk.LEFT, padx=10)
        
        row2 = ttk.Frame(top_frame)
        row2.pack(side=tk.TOP, fill=tk.X, pady=5)
        
        self.bg_order = tk.StringVar(value="1")
        ttk.Label(row2, text="BG Fit:").pack(side=tk.LEFT, padx=(5, 2))
        ttk.Combobox(row2, textvariable=self.bg_order, values=["0", "1", "2", "3", "4", "5", "6", "Spline"], width=6, state="readonly").pack(side=tk.LEFT, padx=2)
        self.bg_order.trace_add("write", lambda *args: self.process_data())
        
        self.spline_s_var = tk.StringVar(value="")
        ttk.Label(row2, text="Spline s:").pack(side=tk.LEFT, padx=(5, 2))
        ttk.Entry(row2, textvariable=self.spline_s_var, width=5).pack(side=tk.LEFT)
        self.spline_s_var.trace_add("write", lambda *args: self.process_data())
        
        self.data_xmin_var = tk.StringVar(value="")
        self.data_xmax_var = tk.StringVar(value="")
        self.excl_xmin_var = tk.StringVar(value="")
        self.excl_xmax_var = tk.StringVar(value="")
        
        ttk.Label(row2, text="Data min:").pack(side=tk.LEFT, padx=(10, 2))
        ttk.Entry(row2, textvariable=self.data_xmin_var, width=6).pack(side=tk.LEFT)
        ttk.Label(row2, text="max:").pack(side=tk.LEFT, padx=2)
        ttk.Entry(row2, textvariable=self.data_xmax_var, width=6).pack(side=tk.LEFT)
        ttk.Button(row2, text="Apply Range", command=lambda: self.apply_data_limits(reset_peak=False)).pack(side=tk.LEFT, padx=5)
        ttk.Button(row2, text="Auto-Find", command=self.auto_find_peak).pack(side=tk.LEFT, padx=2)
        ttk.Button(row2, text="Reset Range", command=self.reset_data_limits).pack(side=tk.LEFT, padx=2)
        
        row3 = ttk.Frame(top_frame)
        row3.pack(side=tk.TOP, fill=tk.X, pady=5)
        
        self.denoise_var = tk.BooleanVar(value=False)
        self.cutoff_var = tk.StringVar(value="10.0")
        ttk.Checkbutton(row3, text="Denoise BG", variable=self.denoise_var, command=self.process_data).pack(side=tk.LEFT, padx=2)
        ttk.Label(row3, text="Cutoff (\u03bcm):").pack(side=tk.LEFT)
        ttk.Entry(row3, textvariable=self.cutoff_var, width=5).pack(side=tk.LEFT)
        self.cutoff_var.trace_add("write", lambda *args: self.process_data())
        
        ttk.Label(row3, text="Exclude BG min:").pack(side=tk.LEFT, padx=(15, 2))
        ttk.Entry(row3, textvariable=self.excl_xmin_var, width=6).pack(side=tk.LEFT)
        self.excl_xmin_var.trace_add("write", lambda *args: self.process_data())
        ttk.Label(row3, text="max:").pack(side=tk.LEFT, padx=2)
        ttk.Entry(row3, textvariable=self.excl_xmax_var, width=6).pack(side=tk.LEFT)
        self.excl_xmax_var.trace_add("write", lambda *args: self.process_data())

        res_frame = ttk.LabelFrame(left_frame, text="Current Peak Results")
        res_frame.pack(side=tk.TOP, fill=tk.X, padx=5, pady=5)
        self.res_height = tk.StringVar(value="Peak Height: N/A")
        self.res_fwhm = tk.StringVar(value="FWHM: N/A")
        self.res_area = tk.StringVar(value="Cross-sectional Area: N/A")
        ttk.Label(res_frame, textvariable=self.res_height, font=("TkDefaultFont", 10, "bold")).pack(side=tk.LEFT, padx=10)
        ttk.Label(res_frame, textvariable=self.res_fwhm, font=("TkDefaultFont", 10, "bold")).pack(side=tk.LEFT, padx=10)
        ttk.Label(res_frame, textvariable=self.res_area, font=("TkDefaultFont", 10, "bold")).pack(side=tk.LEFT, padx=10)
        
        ttk.Label(left_frame, text="Drag on the TOP graph to select the peak region. Data outside this region will be used for BG subtraction.").pack(side=tk.TOP, pady=2)
        
        self.fig, (self.ax_raw, self.ax_corr) = plt.subplots(2, 1, figsize=(8, 8))
        self.fig.subplots_adjust(hspace=0.4, top=0.92, bottom=0.08, left=0.1, right=0.95)
        
        self.canvas = FigureCanvasTkAgg(self.fig, master=left_frame)
        self.canvas.draw()
        
        toolbar = NavigationToolbar2Tk(self.canvas, left_frame)
        toolbar.update()
        self.canvas.get_tk_widget().pack(side=tk.TOP, fill=tk.BOTH, expand=True)
        
        self.span = SpanSelector(self.ax_raw, self.on_select, 'horizontal', useblit=True,
                                 props=dict(alpha=0.2, facecolor='red'),
                                 interactive=True, drag_from_anywhere=True)

        # --- Right Frame (Data Table) ---
        table_label = ttk.Label(right_frame, text="Saved Results", font=("TkDefaultFont", 12, "bold"))
        table_label.pack(side=tk.TOP, pady=(10,5))
        
        columns = ("Filename", "Height", "FWHM", "Area")
        self.tree = ttk.Treeview(right_frame, columns=columns, show="headings")
        for col in columns:
            self.tree.heading(col, text=col)
            if col == "Filename":
                self.tree.column(col, width=120, anchor=tk.W)
            else:
                self.tree.column(col, width=80, anchor=tk.E)
                
        tree_scroll = ttk.Scrollbar(right_frame, orient=tk.VERTICAL, command=self.tree.yview)
        self.tree.configure(yscrollcommand=tree_scroll.set)
        tree_scroll.pack(side=tk.RIGHT, fill=tk.Y)
        self.tree.pack(side=tk.TOP, fill=tk.BOTH, expand=True)
        
        btn_frame = ttk.Frame(right_frame)
        btn_frame.pack(side=tk.BOTTOM, fill=tk.X, pady=10)
        
        row_btn1 = ttk.Frame(btn_frame)
        row_btn1.pack(side=tk.TOP, fill=tk.X, pady=2)
        ttk.Button(row_btn1, text="Add Data", command=self.add_to_table).pack(side=tk.LEFT, expand=True, fill=tk.X, padx=2)
        ttk.Button(row_btn1, text="Delete Selected", command=self.delete_selected).pack(side=tk.LEFT, expand=True, fill=tk.X, padx=2)
        
        row_btn2 = ttk.Frame(btn_frame)
        row_btn2.pack(side=tk.TOP, fill=tk.X, pady=2)
        ttk.Button(row_btn2, text="Export CSV", command=self.export_table).pack(side=tk.LEFT, expand=True, fill=tk.X, padx=2)
        ttk.Button(row_btn2, text="Clear Data", command=self.clear_table).pack(side=tk.LEFT, expand=True, fill=tk.X, padx=2)

    def load_file(self):
        filepath = filedialog.askopenfilename(filetypes=[("CSV Files", "*.csv"), ("All Files", "*.*")])
        if filepath:
            self.csv_files = [filepath]
            self.current_idx = 0
            self.load_current_file()

    def load_folder(self):
        folder = filedialog.askdirectory()
        if folder:
            files = sorted(glob.glob(os.path.join(folder, "*.csv")))
            if not files:
                messagebox.showinfo("No CSVs", "No CSV files found in directory.")
                return
            self.csv_files = files
            self.current_idx = 0
            self.load_current_file()

    def prev_file(self):
        if self.csv_files and self.current_idx > 0:
            self.current_idx -= 1
            self.load_current_file()

    def next_file(self):
        if self.csv_files and self.current_idx < len(self.csv_files) - 1:
            self.current_idx += 1
            self.load_current_file()

    def load_current_file(self):
        self.filepath = self.csv_files[self.current_idx]
        name = os.path.basename(self.filepath)
        self.file_label.config(text=f"[{self.current_idx+1}/{len(self.csv_files)}] {name}")
        
        self.x_full, self.y_full = load_data(self.filepath)
        if self.x_full is not None:
            self.apply_data_limits(reset_peak=True)

    def reset_data_limits(self):
        self.data_xmin_var.set("")
        self.data_xmax_var.set("")
        self.excl_xmin_var.set("")
        self.excl_xmax_var.set("")
        self.apply_data_limits(reset_peak=False)

    def apply_data_limits(self, reset_peak=False):
        if self.x_full is None: return
        try:
            xmin_str = self.data_xmin_var.get()
            xmax_str = self.data_xmax_var.get()
            mask = np.ones_like(self.x_full, dtype=bool)
            if xmin_str.strip():
                mask &= (self.x_full >= float(xmin_str))
            if xmax_str.strip():
                mask &= (self.x_full <= float(xmax_str))
                
            if np.any(mask):
                self.x = self.x_full[mask]
                self.y = self.y_full[mask]
            else:
                messagebox.showwarning("Warning", "Data range is empty!")
                return
        except Exception as e:
            messagebox.showerror("Error", f"Invalid data range: {e}")
            self.x = self.x_full
            self.y = self.y_full
            
        if reset_peak:
            self.peak_region = [None, None]
            self.initial_plot()
        else:
            if self.peak_region[0] is not None and self.peak_region[1] is not None:
                pmin, pmax = self.peak_region
                if pmax > self.x.min() and pmin < self.x.max():
                    self.initial_plot(reprocessing=True)
                    self.process_data()
                else:
                    self.peak_region = [None, None]
                    self.initial_plot()
            else:
                self.initial_plot()

    def save_svg(self):
        if not self.filepath: return
        base = os.path.basename(self.filepath)
        default_name = os.path.splitext(base)[0] + "-plot.svg"
        save_path = filedialog.asksaveasfilename(
            defaultextension=".svg",
            initialfile=default_name,
            filetypes=[("SVG Files", "*.svg")]
        )
        if save_path:
            self.fig.savefig(save_path, format="svg", bbox_inches='tight')
            messagebox.showinfo("Saved", f"Successfully saved to:\n{save_path}")

    def initial_plot(self, reprocessing=False):
        self.ax_raw.clear()
        self.ax_corr.clear()
        self.ax_raw.plot(self.x, self.y, 'C0-', label='Raw Data')
        self.ax_raw.set_title("Raw Profilometry Data")
        self.ax_raw.set_xlabel("Lateral (\u03bcm)")
        self.ax_raw.set_ylabel("Profile (\u03bcm)")
        self.ax_raw.legend(loc='upper right')
        
        if not reprocessing:
            self.ax_corr.set_title("Background Subtracted Peak")
            self.ax_corr.set_xlabel("Lateral (\u03bcm)")
            self.ax_corr.set_ylabel("Profile (\u03bcm)")
            self.reset_results()
        
        self.fig.subplots_adjust(hspace=0.4)
        
        self.canvas.draw()
        
        self.span = SpanSelector(self.ax_raw, self.on_select, 'horizontal', useblit=True,
                                 props=dict(alpha=0.2, facecolor='red'),
                                 interactive=True, drag_from_anywhere=True)

    def on_select(self, xmin, xmax):
        self.peak_region = [xmin, xmax]
        self.process_data()

    def auto_find_peak(self):
        if self.x is None or self.y is None: return
        
        p_lin = np.polyfit(self.x, self.y, 1)
        z_lin = self.y - np.polyval(p_lin, self.x)
        
        peaks, properties = find_peaks(z_lin, height=np.max(z_lin)*0.5, width=5)
        if len(peaks) > 0:
            main_peak_idx = peaks[np.argmax(properties['peak_heights'])]
            widths = peak_widths(z_lin, [main_peak_idx], rel_height=0.95)
            w_idx = widths[0][0]
            w_um = w_idx * (self.x[1] - self.x[0])
            mask_width = w_um * 2.0
            
            peak_x = self.x[main_peak_idx]
            self.peak_region = [max(self.x[0], peak_x - mask_width/2), min(self.x[-1], peak_x + mask_width/2)]
            
            self.process_data()
        else:
            messagebox.showinfo("Auto Find", "Could not automatically identify a distinct peak.")

    def reset_results(self):
        self.current_height = None
        self.current_fwhm = None
        self.current_area = None
        
        self.res_height.set("Peak Height: N/A")
        self.res_fwhm.set("FWHM: N/A")
        self.res_area.set("Cross-sectional Area: N/A")

    def process_data(self, *args):
        if self.x is None or self.y is None or self.peak_region[0] is None:
            return
            
        xmin, xmax = self.peak_region
        peak_mask = (self.x >= xmin) & (self.x <= xmax)
        bg_mask = ~peak_mask
        
        excl_min = None
        excl_max = None
        excl_xmin_str = self.excl_xmin_var.get()
        excl_xmax_str = self.excl_xmax_var.get()
        if excl_xmin_str.strip() and excl_xmax_str.strip():
            try:
                excl_min = float(excl_xmin_str)
                excl_max = float(excl_xmax_str)
                bg_mask &= ~((self.x >= excl_min) & (self.x <= excl_max))
            except ValueError:
                pass
                
        if not np.any(bg_mask):
            return
            
        x_bg = self.x[bg_mask]
        
        # Denoising
        y_for_bg = np.copy(self.y)
        if self.denoise_var.get():
            try:
                cutoff_str = self.cutoff_var.get()
                if cutoff_str.strip():
                    cutoff = float(cutoff_str)
                    if cutoff > 0:
                        dx = np.mean(np.diff(self.x))
                        fs = 1.0 / dx
                        nyq = 0.5 * fs
                        cutoff_freq = 1.0 / cutoff
                        if cutoff_freq < nyq:
                            b, a = butter(2, cutoff_freq/nyq, btype='low', analog=False)
                            left_mask = self.x < xmin
                            right_mask = self.x > xmax
                            if np.sum(left_mask) > 15:
                                y_for_bg[left_mask] = filtfilt(b, a, self.y[left_mask])
                            if np.sum(right_mask) > 15:
                                y_for_bg[right_mask] = filtfilt(b, a, self.y[right_mask])
            except Exception:
                pass # Ignore if invalid
                
        y_bg = y_for_bg[bg_mask]
        
        order_str = self.bg_order.get()
        if order_str == "Spline":
            sort_idx = np.argsort(x_bg)
            x_u, u_idx = np.unique(x_bg[sort_idx], return_index=True)
            y_u = y_bg[sort_idx][u_idx]
            
            # Spline smoothing parameter
            s_val = None
            s_str = self.spline_s_var.get()
            if s_str.strip():
                try:
                    s_val = float(s_str)
                except ValueError:
                    pass
            
            # Fallback to linear if not enough points for spline
            if len(x_u) > 3:
                spl = UnivariateSpline(x_u, y_u, s=s_val)
                bg_fit = spl(self.x)
            else:
                p = np.polyfit(x_bg, y_bg, 1)
                bg_fit = np.polyval(p, self.x)
            order_label = "Spline"
        else:
            order = int(order_str)
            p = np.polyfit(x_bg, y_bg, order)
            bg_fit = np.polyval(p, self.x)
            order_label = f"Order {order}"
        
        y_corr = self.y - bg_fit
        
        self.ax_raw.clear()
        self.ax_raw.plot(self.x, self.y, 'C0-', label='Raw Data')
        if self.denoise_var.get() and np.any(y_for_bg != self.y):
            left_mask = self.x < xmin
            right_mask = self.x > xmax
            if np.sum(left_mask) > 0:
                self.ax_raw.plot(self.x[left_mask], y_for_bg[left_mask], 'g-', label='Denoised BG' if not np.any(right_mask) else 'Denoised BG', alpha=0.8)
            if np.sum(right_mask) > 0:
                self.ax_raw.plot(self.x[right_mask], y_for_bg[right_mask], 'g-', label='_nolegend_' if np.sum(left_mask) > 0 else 'Denoised BG', alpha=0.8)
            
        self.ax_raw.plot(self.x, bg_fit, 'C1--', label=f'BG Fit ({order_label})')
        self.ax_raw.axvspan(xmin, xmax, color='red', alpha=0.1, label='Selected Peak')
        if excl_min is not None and excl_max is not None:
            self.ax_raw.axvspan(excl_min, excl_max, color='gray', alpha=0.2, label='Excluded BG')
            
        self.ax_raw.set_title("Raw Data & Background Fit")
        self.ax_raw.set_xlabel("Lateral (\u03bcm)")
        self.ax_raw.set_ylabel("Profile (\u03bcm)")
        self.ax_raw.legend(loc='upper right')
        
        self.span = SpanSelector(self.ax_raw, self.on_select, 'horizontal', useblit=True,
                                 props=dict(alpha=0.2, facecolor='red'),
                                 interactive=True, drag_from_anywhere=True)
        self.span.extents = (xmin, xmax)
        
        x_peak = self.x[peak_mask]
        y_peak_corr = y_corr[peak_mask]
        
        self.ax_corr.clear()
        self.ax_corr.plot(x_peak, y_peak_corr, 'C2-', label='Subtracted Peak')
        self.ax_corr.set_title("Background Subtracted Data")
        self.ax_corr.set_xlabel("Lateral (\u03bcm)")
        self.ax_corr.set_ylabel("Profile (\u03bcm)")
        
        self.fig.subplots_adjust(hspace=0.4)
        
        if len(y_peak_corr) > 0:
            self.current_height = np.max(y_peak_corr)
            
            # Sub-peak analysis
            peaks, properties = find_peaks(y_peak_corr, height=self.current_height*0.5)
            if len(peaks) > 0:
                main_peak_idx = peaks[np.argmax(properties['peak_heights'])]
                
                # FWHM
                widths_results = peak_widths(y_peak_corr, [main_peak_idx], rel_height=0.5)
                full_width = widths_results[0][0]
                self.current_fwhm = full_width * (x_peak[1] - x_peak[0])
                
                h = widths_results[1][0]
                xmin_real = x_peak[0] + widths_results[2][0] * (x_peak[1] - x_peak[0])
                xmax_real = x_peak[0] + widths_results[3][0] * (x_peak[1] - x_peak[0])
                self.ax_corr.hlines(h, xmin_real, xmax_real, color='m', linestyle='-', linewidth=2, label=f'FWHM: {self.current_fwhm:.2f} \u03bcm')
                
                # Area
                base_widths = peak_widths(y_peak_corr, [main_peak_idx], rel_height=0.98)
                left_idx = int(base_widths[2][0])
                right_idx = int(base_widths[3][0])
                left_idx = max(0, left_idx)
                right_idx = min(len(x_peak)-1, right_idx)
                
                if right_idx > left_idx:
                    self.current_area = np.trapezoid(y_peak_corr[left_idx:right_idx], x_peak[left_idx:right_idx])
                    self.ax_corr.fill_between(x_peak[left_idx:right_idx], 0, y_peak_corr[left_idx:right_idx], color='yellow', alpha=0.3, label='Integrated Area (CSA)')
                else:
                    self.current_area = 0.0
            else:
                self.current_fwhm = None
                self.current_area = np.trapezoid(y_peak_corr, x_peak) # fallback
                self.ax_corr.fill_between(x_peak, 0, y_peak_corr, color='yellow', alpha=0.3, label='Integrated Area (CSA)')
            
            self.ax_corr.legend(loc='upper right')
            
            text_str = f"Cross-sectional Area: {self.current_area:.4f} \u03bcm\u00b2"
            self.ax_corr.text(0.02, 0.95, text_str, 
                              transform=self.ax_corr.transAxes, 
                              verticalalignment='top',
                              fontsize=10, bbox=dict(facecolor='white', alpha=0.8, edgecolor='none'))
                
            self.res_height.set(f"Peak Height: {self.current_height:.4f} \u03bcm")
            self.res_fwhm.set(f"FWHM: {self.current_fwhm:.4f} \u03bcm" if self.current_fwhm is not None else "FWHM: N/A")
            self.res_area.set(f"Cross-sectional Area: {self.current_area:.4f} \u03bcm\u00b2")
        
        self.canvas.draw()

    def add_to_table(self):
        if not self.filepath:
            return
        base = os.path.basename(self.filepath)
        filename_no_ext = os.path.splitext(base)[0]
        
        h_str = f"{self.current_height:.4f}" if self.current_height is not None else "N/A"
        f_str = f"{self.current_fwhm:.4f}" if self.current_fwhm is not None else "N/A"
        a_str = f"{self.current_area:.4f}" if self.current_area is not None else "N/A"
        
        self.tree.insert("", tk.END, values=(filename_no_ext, h_str, f_str, a_str))

    def delete_selected(self):
        for item in self.tree.selection():
            self.tree.delete(item)

    def clear_table(self):
        for item in self.tree.get_children():
            self.tree.delete(item)

    def export_table(self):
        children = self.tree.get_children()
        if not children:
            messagebox.showinfo("Empty Table", "No data to export.")
            return
            
        save_path = filedialog.asksaveasfilename(
            defaultextension=".csv",
            initialfile="profilometry_results.csv",
            filetypes=[("CSV Files", "*.csv")]
        )
        if save_path:
            records = []
            for item in children:
                records.append(self.tree.item(item, 'values'))
            df = pd.DataFrame(records, columns=["Filename", "Height", "FWHM", "Area"])
            df.to_csv(save_path, index=False)
            messagebox.showinfo("Exported", f"Data exported to {save_path}")

if __name__ == "__main__":
    app = ProfilometryApp()
    app.mainloop()
