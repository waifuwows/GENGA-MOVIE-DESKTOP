import sys
import os
import asyncio
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# --- FIX: PATCH GAANAPY FOR STANDALONE RUNTIME ---
# GaanaPy 0.1.0 creates aiohttp.ClientSession() at import time.
# This causes RuntimeError: no running event loop in some environments.
try:
    import aiohttp
    import gaanapy.gaanapy
    import gaanapy
    
    class LazyGaanaPy(gaanapy.gaanapy.GaanaPy):
        def __init__(self):
            # Manually initialize components instead of calling super().__init__
            # which would trigger the ClientSession creation.
            self.api_endpoints = gaanapy.gaanapy.endpoints
            from gaanapy.functions import Functions
            from gaanapy.errors import Errors
            self.functions = Functions()
            self.errors = Errors()
            self.info = False
            self._session = None

        @property
        def aiohttp(self):
            # Check if session exists or is closed
            if self._session is None or self._session.closed:
                try:
                    # Try to get the current loop, but don't fail if not running
                    # aiohttp will find it when it needs it.
                    self._session = aiohttp.ClientSession()
                except Exception:
                    # Fallback
                    self._session = aiohttp.ClientSession()
            return self._session
            
        @aiohttp.setter
        def aiohttp(self, value):
            self._session = value

    # Apply the patch to both the module and the class
    gaanapy.gaanapy.GaanaPy = LazyGaanaPy
    gaanapy.GaanaPy = LazyGaanaPy
    print("Successfully patched GaanaPy for lazy session initialization")
except Exception as e:
    print(f"Warning: Could not patch GaanaPy: {e}")

# --- EXTREME PATH DEFENSE ---
if getattr(sys, 'frozen', False):
    # PyInstaller extracts everything to sys._MEIPASS
    base_dir = getattr(sys, '_MEIPASS', os.path.dirname(sys.executable))
    
    # Aggressively add all possible locations to path
    paths_to_add = [
        base_dir,
        os.path.join(base_dir, 'backend'),
        os.path.join(base_dir, '_internal'),
        os.path.join(base_dir, '_internal', 'backend')
    ]
    
    for p in paths_to_add:
        if os.path.exists(p) and p not in sys.path:
            sys.path.insert(0, p) # Higher priority
            
    # CRITICAL: Debug log in home dir if things are messy
    try:
        log_path = os.path.join(os.path.expanduser("~"), "genga_backend_debug.log")
        with open(log_path, "w") as f:
            f.write(f"Frozen: True\nMEIPASS: {base_dir}\n")
            f.write(f"Path: {sys.path}\n")
    except:
        pass
else:
    base_dir = os.path.dirname(os.path.abspath(__file__))
    if base_dir not in sys.path:
        sys.path.append(base_dir)

try:
    from api import router as api_router
except ImportError as e:
    # Final fallback for internal folder structure
    try:
        from backend.api import router as api_router
    except ImportError:
        raise e

if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

app = FastAPI(title="Genga Movie", description="API for Genga Movie Desktop App")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for mobile app access
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api")

@app.get("/")
@app.head("/")
async def root():
    return {"message": "Welcome to MovieBox API"}

@app.get("/api/health")
@app.head("/api/health")
async def health_check():
    return {"status": "ok"}

if __name__ == "__main__":
    import multiprocessing
    multiprocessing.freeze_support()
    
    import uvicorn
    # Use the app object directly to avoid uvicorn's internal string-based re-import
    # which can fail on some standalone environments.
    uvicorn.run(app, host="127.0.0.1", port=8000, workers=1, log_level="info")

