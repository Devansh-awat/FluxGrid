
document.addEventListener('DOMContentLoaded', () => {
    // Auto-detect specs (Cores, etc.)
    detectSpecs();

    // Background Gradient Effect
    document.addEventListener('mousemove', (e) => {
        const x = (e.clientX / window.innerWidth) * 100;
        const y = (e.clientY / window.innerHeight) * 100;
        document.body.style.backgroundImage = `
            radial-gradient(circle at ${x}% ${y}%, rgba(0, 255, 157, 0.15) 0%, transparent 50%),
            radial-gradient(circle at ${100 - x}% ${100 - y}%, rgba(0, 184, 255, 0.15) 0%, transparent 50%)
        `;
    });

    // Resource Toggle Logic (Step 3)
    const resources = ['cpu', 'gpu', 'storage', 'network'];
    resources.forEach(res => {
        const checkbox = document.getElementById(`${res}Cb`);
        const details = document.getElementById(`${res}Details`);
        if (checkbox && details) {
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) details.classList.remove('hidden');
                else details.classList.add('hidden');
            });
        }
    });

    // Device Type Listener (Step 1)
    const deviceRadios = document.querySelectorAll('input[name="deviceType"]');
    const batteryWrapper = document.getElementById('batteryWrapper');

    function updateDeviceOptions() {
        const selected = document.querySelector('input[name="deviceType"]:checked').value;
        if (selected === 'laptop' && batteryWrapper) {
            batteryWrapper.classList.remove('hidden');
        } else if (batteryWrapper) {
            batteryWrapper.classList.add('hidden');
        }
    }
    deviceRadios.forEach(r => r.addEventListener('change', updateDeviceOptions));
    // Initial call to set state based on default checked
    updateDeviceOptions();
    setupSlider('gpuPercent', 'gpuPercentVal');
    setupSlider('pluggedInPercent', 'pluggedInVal');

    // Data Cap Slider Logic
    const dataCapSlider = document.getElementById('dataCapSlider');
    const dataCapLabel = document.getElementById('dataCapVal');

    if (dataCapSlider && dataCapLabel) {
        dataCapSlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            if (val > 5000) {
                dataCapLabel.innerText = 'Unlimited';
            } else if (val >= 1000) {
                dataCapLabel.innerText = (val / 1000).toFixed(1) + ' TB';
            } else {
                dataCapLabel.innerText = val + ' GB';
            }
        });
    }

    // Speed Test Button
    const speedBtn = document.getElementById('startSpeedTestBtn');
    if (speedBtn) {
        speedBtn.addEventListener('click', runSpeedTest);
    }

    // Form Submission
    const form = document.getElementById('resourceForm');
    form.addEventListener('submit', handleSubmission);
});

function setupSlider(id, labelId) {
    const slider = document.getElementById(id);
    const label = document.getElementById(labelId);
    if (slider && label) {
        slider.addEventListener('input', (e) => label.innerText = e.target.value);
    }
}

let currentStep = 1;
const TOTAL_STEPS = 3;

function nextStep(step) {
    if (step >= TOTAL_STEPS) return;

    // Hide current
    document.querySelector(`.wizard-step[data-step="${step}"]`).classList.add('hidden');

    // Show next
    currentStep = step + 1;
    document.querySelector(`.wizard-step[data-step="${currentStep}"]`).classList.remove('hidden');
}

function prevStep(step) {
    if (step <= 1) return;

    // Hide current
    document.querySelector(`.wizard-step[data-step="${step}"]`).classList.add('hidden');

    // Show prev
    currentStep = step - 1;
    document.querySelector(`.wizard-step[data-step="${currentStep}"]`).classList.remove('hidden');
}

function detectSpecs() {
    // CPU Cores
    if (navigator.hardwareConcurrency) {
        const cpuInput = document.getElementById('cpuCores');
        if (cpuInput) cpuInput.value = navigator.hardwareConcurrency;
    }

    // CPU Model auto-detection
    detectCpuModel();
}

async function detectCpuModel() {
    const cpuModelInput = document.getElementById('cpuModel');
    if (!cpuModelInput) return;

    let model = '';

    // Method 1: High Entropy User-Agent hints (Chrome/Edge 90+)
    try {
        if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
            const hints = await navigator.userAgentData.getHighEntropyValues([
                'architecture', 'bitness', 'model', 'platform', 'platformVersion'
            ]);
            const arch = hints.architecture || '';
            const bitness = hints.bitness || '';
            const platform = hints.platform || '';

            // On mobile devices, 'model' gives the device model
            if (hints.model) {
                model = `${hints.model} (${arch} ${bitness}-bit)`;
            } else if (arch) {
                model = `${platform} ${arch} ${bitness}-bit`;
            }
        }
    } catch (e) {
        // High entropy hints not available or denied
    }

    // Method 2: WebGL renderer string (often contains GPU but sometimes CPU info)
    if (!model) {
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            if (gl) {
                const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
                if (debugInfo) {
                    const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
                    // Some renderers include CPU info (e.g., "ANGLE (Intel... Core i7...)")
                    const cpuMatch = renderer.match(/\(([^)]*(?:Intel|AMD|Apple|Qualcomm|Snapdragon)[^)]*)\)/i);
                    if (cpuMatch) {
                        model = cpuMatch[1].trim();
                    }
                }
            }
        } catch (e) {
            // WebGL not available
        }
    }

    // Method 3: Fallback to navigator.platform + core count
    if (!model) {
        const platform = navigator.platform || 'Unknown';
        const cores = navigator.hardwareConcurrency || '?';
        model = `${platform} (${cores} threads)`;
    }

    cpuModelInput.value = model;
    cpuModelInput.placeholder = 'e.g. Intel Core i7-12700K';
}

// Speed Test Logic
let testInterval = null;

function runSpeedTest() {
    const btn = document.getElementById('startSpeedTestBtn');
    const progress = document.getElementById('speedProgress');
    const fill = progress.querySelector('.fill');
    const dlDisplay = document.getElementById('dlSpeedDisplay');
    const ulDisplay = document.getElementById('ulSpeedDisplay');
    const dlInput = document.getElementById('networkSpeedDown');
    const ulInput = document.getElementById('networkSpeedUp');

    btn.disabled = true;
    btn.innerHTML = 'Testing...';
    progress.classList.remove('hidden');
    fill.style.width = '0%';

    let duration = 5000; // 5 seconds
    let startTime = Date.now();

    // Simulation variables
    let currentDl = 0;
    let currentUl = 0;

    // Attempt real download speed if possible, else simulate
    // For local file:// or sandboxed environments, real Fetch might fail or be instant.
    // We will use a simulation that "feels" real for this demo/prototype.

    testInterval = setInterval(() => {
        let elapsed = Date.now() - startTime;
        let p = Math.min((elapsed / duration) * 100, 100);
        fill.style.width = `${p}%`;

        // Simulate fluctuation
        // Random speed between 50 and 300 Mbps
        let simDl = Math.floor(Math.random() * (300 - 50) + 50);
        let simUl = Math.floor(simDl * 0.4); // Upload usually slower

        // Smoothing
        currentDl = Math.floor((currentDl * 0.7) + (simDl * 0.3));
        currentUl = Math.floor((currentUl * 0.7) + (simUl * 0.3));

        dlDisplay.innerText = currentDl;
        ulDisplay.innerText = currentUl;

        if (elapsed >= duration) {
            clearInterval(testInterval);
            finishTest(currentDl, currentUl);
        }
    }, 100);

    function finishTest(dl, ul) {
        btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg> Test Complete';
        btn.disabled = false; // Allow re-run?

        // Update Inputs
        dlInput.value = dl;
        ulInput.value = ul;

        // Auto-select data cap based on speed? (Optional, skipping for now)
    }
}

async function handleSubmission(e) {
    e.preventDefault();

    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());

    // Get multi-value inputs
    data.resources = formData.getAll('resources');
    data.incentives = formData.getAll('incentives');
    data.alwaysPluggedIn = document.getElementById('batteryCb') ? !document.getElementById('batteryCb').checked : true; // Inverted logic in variable name vs UI, but let's stick to form data

    if (data.resources.length === 0) {
        showStatus('Warning: You haven\'t selected any resources to share.', 'error');
        return;
    }

    const submitBtn = document.querySelector('.submit-btn');
    const originalBtnText = submitBtn.innerText;
    submitBtn.innerText = 'Submitting...';
    submitBtn.disabled = true;

    try {
        // Submit to Vercel API
        const response = await fetch('/api/submit', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || 'Submission failed.');
        }

        const result = await response.json();

        if (result) {
            localStorage.setItem('fluxGridSubmission', Date.now().toString());
            showStatus(result.message || 'Success! Your device profile has been recorded.', 'success');
            submitBtn.innerText = 'Submitted';

            // Disable form
            const inputs = document.querySelectorAll('input, select, button');
            inputs.forEach(i => i.disabled = true);
        }

    } catch (error) {
        console.error('Submission Error:', error);
        showStatus(error.message, 'error');
        submitBtn.innerText = originalBtnText;
        submitBtn.disabled = false;
    }
}

function showStatus(message, type) {
    const statusMsg = document.getElementById('statusMessage');
    statusMsg.textContent = message;
    statusMsg.className = type;

    if (type === 'error') {
        setTimeout(() => {
            statusMsg.textContent = '';
            statusMsg.className = '';
        }, 5000);
    }
}
