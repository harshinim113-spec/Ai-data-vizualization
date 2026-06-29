/* ============================================================
   AI Data Visualization Assistant — Client-Side Application
   ============================================================ */

(function () {
    'use strict';

    /* ---------- STATE ---------- */
    let currentColumns = [];
    let currentDtypes = {};
    let currentFilename = '';
    let isAiProcessing = false;

    /* ---------- DOM REFERENCES ---------- */
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    /* ---------- PLOTLY DARK LAYOUT ---------- */
    const PLOTLY_LAYOUT_DEFAULTS = {
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        font: { color: '#e2e8f0', family: 'Inter, sans-serif', size: 13 },
        margin: { t: 48, r: 24, b: 56, l: 56 },
        xaxis: {
            gridcolor: 'rgba(255,255,255,0.05)',
            zerolinecolor: 'rgba(255,255,255,0.08)',
            tickfont: { color: '#94a3b8' }
        },
        yaxis: {
            gridcolor: 'rgba(255,255,255,0.05)',
            zerolinecolor: 'rgba(255,255,255,0.08)',
            tickfont: { color: '#94a3b8' }
        },
        colorway: ['#8b5cf6', '#22d3ee', '#10b981', '#f59e0b', '#f43f5e', '#6366f1', '#ec4899', '#14b8a6'],
        hoverlabel: {
            bgcolor: '#1e1b4b',
            bordercolor: '#6366f1',
            font: { color: '#e2e8f0', size: 13 }
        },
        legend: {
            font: { color: '#94a3b8' },
            bgcolor: 'rgba(0,0,0,0)'
        }
    };

    const PLOTLY_CONFIG = {
        displayModeBar: true,
        displaylogo: false,
        responsive: true,
        modeBarButtonsToRemove: ['lasso2d', 'select2d']
    };

    /* ==========================================================
       INITIALIZATION
       ========================================================== */

    document.addEventListener('DOMContentLoaded', init);

    function init() {
        initUpload();
        initTabs();
        initChartBuilder();
        initAIChat();
    }

    /* ==========================================================
       UPLOAD LOGIC
       ========================================================== */

    function initUpload() {
        const dropZone = $('#drop-zone');
        const fileInput = $('#file-input');
        const browseBtn = $('#browse-btn');

        if (!dropZone || !fileInput || !browseBtn) return;

        browseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            fileInput.click();
        });

        dropZone.addEventListener('click', () => {
            fileInput.click();
        });

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                uploadFile(e.target.files[0]);
            }
        });

        ['dragenter', 'dragover'].forEach((evt) => {
            dropZone.addEventListener(evt, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.add('dragover');
            });
        });

        ['dragleave', 'drop'].forEach((evt) => {
            dropZone.addEventListener(evt, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.remove('dragover');
            });
        });

        dropZone.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                uploadFile(files[0]);
            }
        });
    }

    function uploadFile(file) {
        const allowed = ['.csv', '.xlsx', '.xls'];
        const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();

        if (!allowed.includes(ext)) {
            showNotification('Invalid file type. Please upload CSV or Excel files.', 'error');
            return;
        }

        if (file.size > 1000 * 1024 * 1024) {
            showNotification('File exceeds 1000MB limit.', 'error');
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        const progressWrapper = $('#progress-wrapper');
        const progressFill = $('#progress-bar-fill');
        const progressText = $('#progress-text');

        progressWrapper.style.display = 'block';
        progressFill.style.width = '0%';
        progressText.textContent = 'Uploading... 0%';

        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const pct = Math.round((e.loaded / e.total) * 100);
                progressFill.style.width = pct + '%';
                progressText.textContent = 'Uploading... ' + pct + '%';
            }
        });

        xhr.addEventListener('load', () => {
            progressFill.style.width = '100%';
            progressText.textContent = 'Processing...';

            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const resp = JSON.parse(xhr.responseText);
                    if (resp.error) {
                        showNotification(resp.error, 'error');
                        progressWrapper.style.display = 'none';
                        return;
                    }
                    handleUploadSuccess(resp);
                } catch (err) {
                    showNotification('Failed to parse server response.', 'error');
                }
            } else {
                let msg = 'Upload failed.';
                try {
                    const errResp = JSON.parse(xhr.responseText);
                    if (errResp.error) msg = errResp.error;
                } catch (_) { /* ignore */ }
                showNotification(msg, 'error');
            }
            progressWrapper.style.display = 'none';
        });

        xhr.addEventListener('error', () => {
            showNotification('Network error during upload.', 'error');
            progressWrapper.style.display = 'none';
        });

        xhr.addEventListener('abort', () => {
            showNotification('Upload cancelled.', 'error');
            progressWrapper.style.display = 'none';
        });

        xhr.open('POST', '/upload');
        xhr.send(formData);
    }

    function handleUploadSuccess(resp) {
        currentFilename = resp.filename || '';
        currentColumns = resp.columns || [];
        currentDtypes = resp.dtypes || {};

        const rows = resp.shape ? resp.shape[0] : 0;
        const cols = resp.shape ? resp.shape[1] : 0;

        $('#info-filename').textContent = currentFilename;
        $('#info-rows').textContent = formatNumber(rows);
        $('#info-columns').textContent = formatNumber(cols);

        const dot = $('#status-dot');
        const statusText = $('#status-text');
        dot.classList.add('active');
        statusText.textContent = 'Dataset loaded';

        populateColumnDropdowns();

        if (resp.preview) renderPreview(resp.preview);
        if (resp.stats) renderStats(resp.stats, currentDtypes);

        $('#upload-section').style.display = 'none';
        const dashSection = $('#dashboard-section');
        dashSection.style.display = 'block';
        animateElement(dashSection);

        switchTab('preview');

        showNotification('Dataset loaded successfully!', 'success');

        loadAutoCharts();
    }

    function populateColumnDropdowns() {
        const xSel = $('#x-column-select');
        const ySel = $('#y-column-select');

        xSel.innerHTML = '<option value="">Select column</option>';
        ySel.innerHTML = '<option value="">Select column</option>';

        currentColumns.forEach((col) => {
            const opt1 = document.createElement('option');
            opt1.value = col;
            opt1.textContent = col;
            xSel.appendChild(opt1);

            const opt2 = document.createElement('option');
            opt2.value = col;
            opt2.textContent = col;
            ySel.appendChild(opt2);
        });
    }

    /* ==========================================================
       DATA PREVIEW
       ========================================================== */

    function renderPreview(data) {
        const container = $('#data-table-container');
        if (!data || data.length === 0) {
            container.innerHTML = '<p class="placeholder-text">No preview data available.</p>';
            return;
        }

        const headers = Object.keys(data[0]);

        let html = '<table class="data-table"><thead><tr>';
        html += '<th>#</th>';
        headers.forEach((h) => {
            html += '<th>' + escapeHtml(h) + '</th>';
        });
        html += '</tr></thead><tbody>';

        data.forEach((row, idx) => {
            html += '<tr>';
            html += '<td>' + (idx + 1) + '</td>';
            headers.forEach((h) => {
                let val = row[h];
                if (val === null || val === undefined) {
                    val = '<span style="color:var(--text-muted);font-style:italic;">null</span>';
                } else {
                    val = escapeHtml(formatCell(val));
                }
                html += '<td>' + val + '</td>';
            });
            html += '</tr>';
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    }

    function formatCell(val) {
        if (typeof val === 'number') {
            if (Number.isInteger(val)) return val.toLocaleString();
            return val.toLocaleString(undefined, { maximumFractionDigits: 4 });
        }
        const s = String(val);
        if (s.length > 80) return s.substring(0, 77) + '...';
        return s;
    }

    /* ==========================================================
       STATISTICS
       ========================================================== */

    function renderStats(stats, dtypes) {
        const container = $('#stats-container');
        if (!stats || Object.keys(stats).length === 0) {
            container.innerHTML = '<p class="placeholder-text">No statistics available.</p>';
            return;
        }

        let html = '';

        Object.keys(stats).forEach((col) => {
            const s = stats[col];
            const dtype = dtypes[col] || 'unknown';
            const isNumeric = dtype.includes('int') || dtype.includes('float') || dtype.includes('num');

            html += '<div class="stat-card fade-in">';
            html += '  <div class="stat-card-header">';
            html += '    <span class="stat-col-name">' + escapeHtml(col) + '</span>';
            html += '    <span class="stat-dtype">' + escapeHtml(dtype) + '</span>';
            html += '  </div>';

            if (s.count !== undefined) {
                html += statRow('Count', formatNumber(s.count));
            }
            if (s.unique !== undefined) {
                html += statRow('Unique', formatNumber(s.unique));
            }
            if (s.missing !== undefined) {
                html += statRow('Missing', formatNumber(s.missing));
            }
            if (s.missing_pct !== undefined) {
                html += statRow('Missing %', s.missing_pct.toFixed(1) + '%');
            }
            if (isNumeric) {
                if (s.mean !== undefined) html += statRow('Mean', formatStat(s.mean));
                if (s.median !== undefined) html += statRow('Median', formatStat(s.median));
                if (s.std !== undefined) html += statRow('Std Dev', formatStat(s.std));
                if (s.min !== undefined) html += statRow('Min', formatStat(s.min));
                if (s.max !== undefined) html += statRow('Max', formatStat(s.max));
            }
            if (s.top !== undefined) {
                html += statRow('Top Value', escapeHtml(String(s.top)));
            }
            if (s.freq !== undefined) {
                html += statRow('Top Freq', formatNumber(s.freq));
            }

            html += '</div>';
        });

        container.innerHTML = html;
    }

    function statRow(label, value) {
        return '<div class="stat-row"><span class="stat-label">' + label + '</span><span class="stat-value">' + value + '</span></div>';
    }

    function formatStat(val) {
        if (val === null || val === undefined) return '—';
        if (typeof val !== 'number') return String(val);
        if (Number.isInteger(val)) return val.toLocaleString();
        return val.toLocaleString(undefined, { maximumFractionDigits: 4 });
    }

    /* ==========================================================
       TAB NAVIGATION
       ========================================================== */

    function initTabs() {
        $$('.tab-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const tab = btn.getAttribute('data-tab');
                switchTab(tab);
            });
        });
    }

    function switchTab(tabName) {
        $$('.tab-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
        });

        $$('.tab-content').forEach((panel) => {
            const id = panel.id;
            const isTarget = id === 'tab-' + tabName;
            panel.style.display = isTarget ? 'block' : 'none';
            if (isTarget) {
                panel.classList.add('active');
                animateElement(panel);
            } else {
                panel.classList.remove('active');
            }
        });

        if (tabName === 'visualize') {
            resizePlotlyCharts();
        }
    }

    function resizePlotlyCharts() {
        setTimeout(() => {
            $$('.plotly-chart').forEach((el) => {
                if (el.data) {
                    Plotly.Plots.resize(el);
                }
            });
        }, 100);
    }

    /* ==========================================================
       CHART BUILDER
       ========================================================== */

    function initChartBuilder() {
        const btn = $('#generate-chart-btn');
        if (btn) btn.addEventListener('click', generateChart);
    }

    function generateChart() {
        const chartType = $('#chart-type-select').value;
        const xCol = $('#x-column-select').value;
        const yCol = $('#y-column-select').value;

        if (!xCol) {
            showNotification('Please select an X-axis column.', 'error');
            return;
        }

        if (['scatter', 'line', 'bar'].includes(chartType) && !yCol) {
            showNotification('Please select a Y-axis column for this chart type.', 'error');
            return;
        }

        showLoading();

        const payload = {
            chart_type: chartType,
            x_column: xCol,
            y_column: yCol || null
        };

        fetch('/visualize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
            .then(handleFetchResponse)
            .then((resp) => {
                hideLoading();
                if (resp.error) {
                    showNotification(resp.error, 'error');
                    return;
                }
                renderCustomChart(resp);
            })
            .catch((err) => {
                hideLoading();
                showNotification('Failed to generate chart: ' + err.message, 'error');
            });
    }

    function renderCustomChart(resp) {
        const wrapper = $('#custom-chart-container');
        const chartEl = $('#custom-chart');
        wrapper.style.display = 'block';

        let chartData, chartLayout;

        if (resp.chart_json) {
            const parsed = typeof resp.chart_json === 'string' ? JSON.parse(resp.chart_json) : resp.chart_json;
            chartData = parsed.data || [];
            chartLayout = Object.assign({}, PLOTLY_LAYOUT_DEFAULTS, parsed.layout || {});
        } else if (resp.data) {
            chartData = resp.data;
            chartLayout = Object.assign({}, PLOTLY_LAYOUT_DEFAULTS, resp.layout || {});
        } else {
            showNotification('No chart data returned.', 'error');
            return;
        }

        Plotly.newPlot(chartEl, chartData, chartLayout, PLOTLY_CONFIG);
        animateElement(wrapper);
    }

    /* ==========================================================
       AUTO-GENERATED CHARTS
       ========================================================== */

    function loadAutoCharts() {
        const container = $('#auto-charts-container');
        container.innerHTML = '<p class="placeholder-text">Generating insights...</p>';

        fetch('/auto-visualize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        })
            .then(handleFetchResponse)
            .then((resp) => {
                if (resp.error) {
                    container.innerHTML = '<p class="placeholder-text">' + escapeHtml(resp.error) + '</p>';
                    return;
                }

                const charts = resp.charts || resp;

                if (!Array.isArray(charts) || charts.length === 0) {
                    container.innerHTML = '<p class="placeholder-text">No auto-generated charts available.</p>';
                    return;
                }

                container.innerHTML = '';

                charts.forEach((chart, idx) => {
                    const card = document.createElement('div');
                    card.className = 'auto-chart-card fade-in';

                    const chartDiv = document.createElement('div');
                    chartDiv.className = 'plotly-chart';
                    chartDiv.id = 'auto-chart-' + idx;
                    card.appendChild(chartDiv);
                    container.appendChild(card);

                    let chartData, chartLayout;

                    if (chart.chart_json) {
                        const parsed = typeof chart.chart_json === 'string' ? JSON.parse(chart.chart_json) : chart.chart_json;
                        chartData = parsed.data || [];
                        chartLayout = Object.assign({}, PLOTLY_LAYOUT_DEFAULTS, parsed.layout || {});
                    } else if (chart.data) {
                        chartData = chart.data;
                        chartLayout = Object.assign({}, PLOTLY_LAYOUT_DEFAULTS, chart.layout || {});
                    } else {
                        chartDiv.innerHTML = '<p class="placeholder-text">Invalid chart data</p>';
                        return;
                    }

                    Plotly.newPlot(chartDiv, chartData, chartLayout, PLOTLY_CONFIG);
                });
            })
            .catch((err) => {
                container.innerHTML = '<p class="placeholder-text">Failed to load auto charts: ' + escapeHtml(err.message) + '</p>';
            });
    }

    /* ==========================================================
       AI CHAT
       ========================================================== */

    function initAIChat() {
        const sendBtn = $('#ai-send-btn');
        const input = $('#ai-input');

        if (sendBtn) {
            sendBtn.addEventListener('click', () => {
                const q = input.value.trim();
                if (q) sendAIQuery(q);
            });
        }

        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    const q = input.value.trim();
                    if (q) sendAIQuery(q);
                }
            });
        }

        $$('.chip').forEach((chip) => {
            chip.addEventListener('click', () => {
                const query = chip.getAttribute('data-query');
                if (query) sendAIQuery(query);
            });
        });
    }

    function sendAIQuery(question) {
        if (isAiProcessing) return;
        isAiProcessing = true;

        const input = $('#ai-input');
        input.value = '';

        addChatMessage(question, 'user');
        showTypingIndicator();
        scrollChatToBottom();

        fetch('/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: question })
        })
            .then(handleFetchResponse)
            .then((resp) => {
                removeTypingIndicator();
                isAiProcessing = false;

                if (resp.error) {
                    if (resp.key_error || resp.error.includes('API key') || resp.error.includes('API_KEY')) {
                        addApiKeyConfigMessage(resp.error);
                    } else {
                        addChatMessage('Sorry, something went wrong: ' + resp.error, 'assistant');
                    }
                    return;
                }

                const answer = resp.answer || resp.response || 'No response received.';
                addChatMessage(answer, 'assistant', resp.chart_json || null);
            })
            .catch((err) => {
                removeTypingIndicator();
                isAiProcessing = false;
                if (err.message.includes('API key') || err.message.includes('API_KEY') || err.message.includes('API key not valid') || err.message.includes('not valid')) {
                    addApiKeyConfigMessage(err.message);
                } else {
                    addChatMessage('Network error: ' + err.message, 'assistant');
                }
            });
    }

    function addApiKeyConfigMessage(errorMsg) {
        const messages = $('#chat-messages');
        const msgDiv = document.createElement('div');
        msgDiv.className = 'chat-message assistant-message';

        const avatarSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2"><path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/><path d="M16 14H8a4 4 0 0 0-4 4v2h16v-2a4 4 0 0 0-4-4z"/></svg>';
        let avatarHtml = '<div class="message-avatar">' + avatarSvg + '</div>';

        let bubbleContent = '<p class="error-text" style="color: #f43f5e; margin-bottom: 8px;"><strong>AI Query Failed:</strong> ' + escapeHtml(errorMsg) + '</p>' +
            '<div class="api-key-setup-box glass-card" style="margin-top: 12px; padding: 12px; border: 1px solid rgba(244, 63, 94, 0.3); border-radius: 12px; background: rgba(15, 20, 35, 0.4);">' +
            '<p style="font-size: 13px; color: #94a3b8; margin-bottom: 10px;">Please enter a valid Google AI Studio Gemini API key to activate the assistant:</p>' +
            '<div style="display: flex; gap: 8px;">' +
            '<input type="password" id="temp-api-key" placeholder="AI Studio API Key..." style="flex: 1; padding: 8px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); background: rgba(0,0,0,0.2); color: #fff; font-size: 13px;">' +
            '<button id="save-key-btn" class="btn btn-primary" style="padding: 8px 16px; font-size: 13px; border-radius: 8px; height: auto; white-space: nowrap;">Save Key</button>' +
            '</div>' +
            '<p style="font-size: 11px; color: #64748b; margin-top: 8px;">Get a free key from <a href="https://aistudio.google.com/apikey" target="_blank" style="color: #22d3ee; text-decoration: underline;">Google AI Studio</a></p>' +
            '</div>';

        msgDiv.innerHTML = avatarHtml + '<div class="message-bubble">' + bubbleContent + '</div>';
        messages.appendChild(msgDiv);
        scrollChatToBottom();

        const saveBtn = msgDiv.querySelector('#save-key-btn');
        const keyInput = msgDiv.querySelector('#temp-api-key');

        if (saveBtn && keyInput) {
            saveBtn.addEventListener('click', () => {
                const key = keyInput.value.trim();
                if (!key) {
                    showNotification('Please enter a key.', 'error');
                    return;
                }
                saveBtn.disabled = true;
                saveBtn.textContent = 'Saving...';

                fetch('/set-api-key', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ api_key: key })
                })
                .then(handleFetchResponse)
                .then((r) => {
                    showNotification('API key updated successfully!', 'success');
                    msgDiv.innerHTML = avatarHtml + '<div class="message-bubble"><p style="color: #10b981;">✓ API key successfully updated! You can now type a question below to retry.</p></div>';
                })
                .catch((e) => {
                    saveBtn.disabled = false;
                    saveBtn.textContent = 'Save Key';
                    showNotification('Failed to save API key: ' + e.message, 'error');
                });
            });
        }
    }

    function addChatMessage(content, role, chartJson) {
        const messages = $('#chat-messages');
        const msgDiv = document.createElement('div');
        msgDiv.className = 'chat-message ' + (role === 'user' ? 'user-message' : 'assistant-message');

        const avatarSvg = role === 'user'
            ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
            : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2"><path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/><path d="M16 14H8a4 4 0 0 0-4 4v2h16v-2a4 4 0 0 0-4-4z"/></svg>';

        let avatarHtml = '<div class="message-avatar">' + avatarSvg + '</div>';

        let bubbleContent = '';
        if (role === 'assistant') {
            try {
                bubbleContent = marked.parse(content);
            } catch (_) {
                bubbleContent = '<p>' + escapeHtml(content) + '</p>';
            }
        } else {
            bubbleContent = '<p>' + escapeHtml(content) + '</p>';
        }

        let chartHtml = '';
        if (chartJson) {
            const chartId = 'ai-chart-' + Date.now();
            chartHtml = '<div class="message-chart"><div class="plotly-chart" id="' + chartId + '"></div></div>';
        }

        msgDiv.innerHTML = avatarHtml + '<div class="message-bubble">' + bubbleContent + chartHtml + '</div>';
        messages.appendChild(msgDiv);
        scrollChatToBottom();

        if (chartJson) {
            const chartId = msgDiv.querySelector('.plotly-chart').id;
            setTimeout(() => renderAIChatChart(chartId, chartJson), 50);
        }
    }

    function renderAIChatChart(elementId, chartJson) {
        const el = document.getElementById(elementId);
        if (!el) return;

        const parsed = typeof chartJson === 'string' ? JSON.parse(chartJson) : chartJson;
        const chartData = parsed.data || [];
        const chartLayout = Object.assign({}, PLOTLY_LAYOUT_DEFAULTS, parsed.layout || {}, {
            margin: { t: 36, r: 16, b: 48, l: 48 },
            height: 300
        });

        Plotly.newPlot(el, chartData, chartLayout, PLOTLY_CONFIG);
    }

    function showTypingIndicator() {
        const messages = $('#chat-messages');
        const indicator = document.createElement('div');
        indicator.className = 'typing-indicator';
        indicator.id = 'typing-indicator';
        indicator.innerHTML = '<div class="message-avatar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2"><path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/><path d="M16 14H8a4 4 0 0 0-4 4v2h16v-2a4 4 0 0 0-4-4z"/></svg></div><div class="typing-dots"><span></span><span></span><span></span></div>';
        messages.appendChild(indicator);
        scrollChatToBottom();
    }

    function removeTypingIndicator() {
        const indicator = $('#typing-indicator');
        if (indicator) indicator.remove();
    }

    function scrollChatToBottom() {
        const messages = $('#chat-messages');
        if (messages) {
            messages.scrollTop = messages.scrollHeight;
        }
    }

    /* ==========================================================
       UTILITY FUNCTIONS
       ========================================================== */

    function showLoading() {
        const overlay = $('#loading-overlay');
        if (overlay) overlay.style.display = 'flex';
    }

    function hideLoading() {
        const overlay = $('#loading-overlay');
        if (overlay) overlay.style.display = 'none';
    }

    function showNotification(message, type) {
        type = type || 'info';
        const container = $('#toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = 'toast ' + type;

        let icon = '';
        if (type === 'success') {
            icon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
        } else if (type === 'error') {
            icon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
        } else {
            icon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
        }

        toast.innerHTML = icon + '<span>' + escapeHtml(message) + '</span>';
        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('fade-out');
            toast.addEventListener('animationend', () => {
                toast.remove();
            });
        }, 4000);
    }

    function formatNumber(num) {
        if (num === null || num === undefined) return '—';
        return Number(num).toLocaleString();
    }

    function animateElement(el) {
        if (!el) return;
        el.classList.remove('fade-in');
        void el.offsetWidth;
        el.classList.add('fade-in');
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function handleFetchResponse(response) {
        if (!response.ok) {
            return response.json().then((data) => {
                throw new Error(data.error || 'Server error ' + response.status);
            }).catch((err) => {
                if (err.message.startsWith('Server error') || err.message) throw err;
                throw new Error('Server error ' + response.status);
            });
        }
        return response.json();
    }

})();
