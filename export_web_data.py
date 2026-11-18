"""
Export CMIP6 temperature-change data for the website.

Reads the cache made by make_proposal_figures.py (cmip6_cache/*.pkl, real GFDL-ESM4
annual means) and writes two small files the D3 visualization loads:

  data/warming.bin   - temperature change vs the 1991-2010 baseline, one byte per
                       grid cell per year (uint8, see meta.json for decoding)
  data/meta.json     - grid coordinates, years, scenarios, decoding rule and the
                       area-weighted global mean change for every scenario and year

Only numpy is needed. Run from the repository folder:
    /usr/local/bin/python3 export_web_data.py ~/Downloads/cmip6_cache
"""
import json
import os
import pickle
import sys

import numpy as np

CACHE = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else "~/Downloads/cmip6_cache")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
os.makedirs(OUT, exist_ok=True)

BASE = (1991, 2010)            # baseline period ("today")
HIST_YEARS = (1900, 2014)      # about 100 years before the baseline
SSP_YEARS = (2015, 2100)       # about 100 years after
SCENARIOS = ["ssp126", "ssp245", "ssp370", "ssp585"]
COARSEN = 2                    # average 2x2 model cells -> ~2° x 2.5° (keeps the file small)
OFFSET, SCALE = 6.0, 10.0      # byte = round((change + OFFSET) * SCALE): -6.0 .. +19.5 °C in 0.1 °C steps


def load(exp):
    with open(os.path.join(CACHE, f"{exp}_annual.pkl"), "rb") as f:
        d = pickle.load(f)
    return d["tas"].astype("float64"), d["year"].astype(int), d["lat"], d["lon"]


def select_years(tas, years, y0, y1):
    keep = (years >= y0) & (years <= y1)
    return tas[keep], years[keep]


def coarsen(a):
    """Average blocks of COARSEN x COARSEN cells. a has shape (..., lat, lon)."""
    *lead, ny, nx = a.shape
    ny2, nx2 = ny // COARSEN, nx // COARSEN
    a = a[..., : ny2 * COARSEN, : nx2 * COARSEN]
    return a.reshape(*lead, ny2, COARSEN, nx2, COARSEN).mean(axis=(-3, -1))


def global_mean(change, lat):
    w = np.cos(np.deg2rad(lat))[:, None] * np.ones((1, change.shape[-1]))
    return (change * w).sum(axis=(-2, -1)) / w.sum()


print(f"Reading cache from {CACHE}")
h_tas, h_years, lat, lon = load("historical")

# make sure latitude runs south -> north and longitude west -> east
lat_order, lon_order = np.argsort(lat), np.argsort(lon)
lat, lon = lat[lat_order], lon[lon_order]
reorder = lambda t: t[:, lat_order][:, :, lon_order]
h_tas = reorder(h_tas)

base_mask = (h_years >= BASE[0]) & (h_years <= BASE[1])
baseline = h_tas[base_mask].mean(axis=0)

frames, gmeans = [], {}
t, y = select_years(h_tas, h_years, *HIST_YEARS)
chg = t - baseline
frames.append(coarsen(chg))
gmeans["historical"] = [round(float(v), 3) for v in global_mean(chg, lat)]
print(f"  historical {y[0]}-{y[-1]} ({len(y)} years)")

for exp in SCENARIOS:
    s_tas, s_years, _, _ = load(exp)
    t, y = select_years(reorder(s_tas), s_years, *SSP_YEARS)
    chg = t - baseline
    frames.append(coarsen(chg))
    gmeans[exp] = [round(float(v), 3) for v in global_mean(chg, lat)]
    print(f"  {exp} {y[0]}-{y[-1]} ({len(y)} years), global mean in {y[-1]}: {gmeans[exp][-1]:+.2f} °C")

allc = np.concatenate(frames, axis=0)                      # (frames, nlat, nlon)
print(f"  change range {allc.min():.2f} to {allc.max():.2f} °C")
q = np.clip(np.round((allc + OFFSET) * SCALE), 0, 255).astype(np.uint8)
q.tofile(os.path.join(OUT, "warming.bin"))

lat_c = coarsen(lat[None, :, None].repeat(len(lon), axis=2))[0, :, 0]
lon_c = coarsen(lon[None, None, :].repeat(len(lat), axis=1))[0, 0, :]
meta = {
    "source": "CMIP6 NOAA-GFDL GFDL-ESM4 r1i1p1f1 Amon tas (annual means)",
    "baseline": f"{BASE[0]}-{BASE[1]}",
    "nlat": int(len(lat_c)), "nlon": int(len(lon_c)),
    "lat": [round(float(v), 3) for v in lat_c],
    "lon": [round(float(v), 3) for v in lon_c],
    "dlat": round(float(np.diff(lat_c).mean()), 4),
    "dlon": round(float(np.diff(lon_c).mean()), 4),
    "hist_years": list(HIST_YEARS),
    "ssp_years": list(SSP_YEARS),
    "scenarios": SCENARIOS,
    "decode": {"offset": OFFSET, "scale": SCALE},
    "frame_order": "historical years, then each scenario's years, in the order of 'scenarios'",
    "global_mean": gmeans,
}
with open(os.path.join(OUT, "meta.json"), "w") as f:
    json.dump(meta, f)

size = os.path.getsize(os.path.join(OUT, "warming.bin")) / 1e6
print(f"\nWrote data/warming.bin ({size:.1f} MB, {q.shape[0]} years x {q.shape[1]} x {q.shape[2]} cells)")
print("Wrote data/meta.json")
