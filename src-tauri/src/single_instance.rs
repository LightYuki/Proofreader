// The named kernel mutex is released even if the process crashes. The PID file
// is only a window-activation hint; its existence never determines ownership.
#[cfg(windows)]
mod platform {
    use std::{fs, hash::{Hash, Hasher}, path::Path, time::Duration};
    use windows_sys::Win32::{Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, HWND, LPARAM},
        System::Threading::CreateMutexW,
        UI::WindowsAndMessaging::{EnumWindows, GetWindowThreadProcessId, IsWindowVisible, IsIconic, SetForegroundWindow, ShowWindowAsync, SW_RESTORE}};

    pub struct InstanceGuard(usize);
    impl Drop for InstanceGuard { fn drop(&mut self) { unsafe { CloseHandle(self.0 as _); } } }

    struct WindowTarget { pid: u32, found: bool }
    unsafe extern "system" fn activate(window: HWND, data: LPARAM) -> i32 {
        let target = &mut *(data as *mut WindowTarget);
        let mut pid = 0;
        GetWindowThreadProcessId(window, &mut pid);
        if pid == target.pid && IsWindowVisible(window) != 0 {
            if IsIconic(window) != 0 { ShowWindowAsync(window, SW_RESTORE); }
            target.found = SetForegroundWindow(window) != 0;
            return 0;
        }
        1
    }

    pub fn acquire(directory: &Path) -> Result<Option<InstanceGuard>, String> {
        let mut hash = std::collections::hash_map::DefaultHasher::new();
        directory.to_string_lossy().to_lowercase().hash(&mut hash);
        let name: Vec<u16> = format!("Local\\Proofread-{:016x}", hash.finish()).encode_utf16().chain(Some(0)).collect();
        let handle = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
        if handle.is_null() { return Err(format!("无法建立单实例保护：{}", std::io::Error::last_os_error())); }
        let already = unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
        let guard = InstanceGuard(handle as usize);
        let pid_path = directory.join("instance.pid");
        if already {
            for _ in 0..20 {
                if let Some(pid) = fs::read_to_string(&pid_path).ok().and_then(|text| text.trim().parse().ok()) {
                    let mut target = WindowTarget { pid, found: false };
                    unsafe { EnumWindows(Some(activate), &mut target as *mut _ as LPARAM); }
                    if target.found { return Ok(None); }
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            return Err("校润已经在运行，请切换到已有窗口；本次未打开第二个工作台。".into());
        }
        fs::write(pid_path, std::process::id().to_string()).map_err(|e| format!("无法登记工作窗口：{e}"))?;
        Ok(Some(guard))
    }
}

#[cfg(windows)]
pub use platform::*;
