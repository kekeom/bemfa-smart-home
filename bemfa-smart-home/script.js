// ==============================================
// 阳光智网系统 - 最终可运行版 script.js
// 功能：
// 1. 巴法云设备控制与状态同步
// 2. TYN1004 太阳能/储能综合数据实时刷新
// 3. 待机断电策略
// 4. 用户自定义恢复时间
// 5. 定时恢复 -> 再次检测 -> 不达标再关闭
// 6. 策略配置同步巴法云
// ==============================================

// =========================
// 系统状态
// =========================
const SystemState = {
    currentPowerMode: 'solar',
    powerThreshold: 400,
    autoSwitchEnabled: true,
    logFilter: 'all',
    systemData: {
        solarPower: 0,
        batteryVoltage: 0,
        batterySoc: 0,
        totalLoad: 0
    }
};

// =========================
// 工具函数
// =========================
const Utils = {
    formatNumber(num, decimals = 1) {
        const n = parseFloat(num);
        return isNaN(n) ? (0).toFixed(decimals) : n.toFixed(decimals);
    },

    safeParseFloat(value, defaultValue = 0) {
        const n = parseFloat(value);
        return isNaN(n) ? defaultValue : n;
    },

    safeParseInt(value, defaultValue = 0) {
        const n = parseInt(value, 10);
        return isNaN(n) ? defaultValue : n;
    },

    clamp(num, min, max) {
        return Math.max(min, Math.min(max, num));
    },

    now() {
        return Date.now();
    },

    formatDateTime(date = new Date()) {
        return date.toLocaleString('zh-CN', {
            hour12: false,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }
};

// =========================
// Topic 工具
// =========================
const TopicUtils = {
    normalizeTopic(topic) {
        return String(topic || '').trim().replace(/\/(up|down)$/i, '');
    },

    isSensorTopic(topic) {
        const t = String(topic || '').trim().toUpperCase();
        return t === 'TYN1004' || t === 'TYN1004/UP';
    }
};

// =========================
// 设备状态中心
// =========================
const DeviceStateStore = {
    devices: {
        AC1: { topic: 'CZ1006', status: 'unknown', online: false, current: 0, lastUpdate: 0 },
        AC2: { topic: 'CZ2006', status: 'unknown', online: false, current: 0, lastUpdate: 0 },
        AC3: { topic: 'CZ3006', status: 'unknown', online: false, current: 0, lastUpdate: 0 },
        AC4: { topic: 'CZ4006', status: 'unknown', online: false, current: 0, lastUpdate: 0 },
        TC1: { topic: 'DC2006', status: 'unknown', online: false, current: 0, lastUpdate: 0 },
        TC2: { topic: 'DC3006', status: 'unknown', online: false, current: 0, lastUpdate: 0 },
        TC3: { topic: 'DC4006', status: 'unknown', online: false, current: 0, lastUpdate: 0 },
        TC4: { topic: 'DC5006', status: 'unknown', online: false, current: 0, lastUpdate: 0 }
    },

    getDeviceByTopic(topic) {
        const normalizedTopic = TopicUtils.normalizeTopic(topic);
        return Object.keys(this.devices).find(key => this.devices[key].topic === normalizedTopic);
    },

    updateDevice(deviceName, patch) {
        if (!this.devices[deviceName]) return;
        this.devices[deviceName] = {
            ...this.devices[deviceName],
            ...patch,
            lastUpdate: Date.now()
        };
    },

    getDevice(deviceName) {
        return this.devices[deviceName] || null;
    }
};

// =========================
// UI 映射
// =========================
const DeviceUIMap = {
    statusIds: {
        AC1: 'bafa-cz1006-status',
        AC2: 'bafa-cz2006-status',
        AC3: 'bafa-cz3006-status',
        AC4: 'bafa-cz4006-status',
        TC1: 'bafa-dc2006-status',
        TC2: 'bafa-dc3006-status',
        TC3: 'bafa-dc4006-status',
        TC4: 'bafa-dc5006-status'
    },

    currentIds: {
        AC1: ['ac1-current', 'ac1-current-display'],
        AC2: ['ac2-current', 'ac2-current-display'],
        AC3: ['ac3-current', 'ac3-current-display'],
        AC4: ['ac4-current', 'ac4-current-display'],
        TC1: ['tc1-current', 'tc1-current-display'],
        TC2: ['tc2-current', 'tc2-current-display'],
        TC3: ['tc3-current', 'tc3-current-display'],
        TC4: ['tc4-current', 'tc4-current-display']
    }
};

// =========================
// 日志
// =========================
const Logger = {
    filterLogs(type, event) {
        SystemState.logFilter = type;

        document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
        if (event && event.target) event.target.classList.add('active');

        const logs = document.querySelectorAll('.log-item');
        logs.forEach(log => {
            if (type === 'all') {
                log.style.display = 'flex';
            } else {
                log.style.display = log.classList.contains(type) ? 'flex' : 'none';
            }
        });
    },

    addLog(message, type = 'info') {
        const logContainer = document.getElementById('logContainer');
        if (!logContainer) {
            console.log(`[${type}] ${message}`);
            return;
        }

        const icons = {
            info: 'ℹ️',
            success: '✅',
            warning: '⚠️',
            error: '❌'
        };

        const logItem = document.createElement('div');
        logItem.className = `log-item ${type}`;
        logItem.innerHTML = `
            <div class="log-content">
                <span class="log-icon">${icons[type] || 'ℹ️'}</span>
                <span class="log-message">${message}</span>
            </div>
            <span class="log-time">${Utils.formatDateTime()}</span>
        `;

        logContainer.insertBefore(logItem, logContainer.firstChild);

        const logs = logContainer.querySelectorAll('.log-item');
        if (logs.length > 100) {
            logContainer.removeChild(logs[logs.length - 1]);
        }
    }
};

// =========================
// 加载层
// =========================
const LoadingManager = {
    loadingCount: 0,

    showLoading(text = '加载中...') {
        this.loadingCount++;
        const oldTextEl = document.querySelector('#loadingOverlay .loading-text');

        if (this.loadingCount === 1) {
            const overlay = document.createElement('div');
            overlay.className = 'loading-overlay';
            overlay.id = 'loadingOverlay';
            overlay.innerHTML = `
                <div class="loading-container">
                    <div class="loading" style="width:40px;height:40px;"></div>
                    <div class="loading-text">${text}</div>
                </div>
            `;
            document.body.appendChild(overlay);
        } else if (oldTextEl) {
            oldTextEl.textContent = text;
        }
    },

    hideLoading() {
        this.loadingCount--;
        if (this.loadingCount <= 0) {
            this.loadingCount = 0;
            const overlay = document.getElementById('loadingOverlay');
            if (overlay) overlay.remove();
        }
    },

    showError(message) {
        Logger.addLog(`❌ ${message}`, 'error');
        console.error(message);
    },

    showSuccess(message) {
        Logger.addLog(`✅ ${message}`, 'success');
        console.log(message);
    }
};

// =========================
// 电池显示
// =========================
const BatteryManager = {
    updateBatteryDisplay(soc) {
        const batteryFill = document.getElementById('batteryFill');
        if (!batteryFill) return;

        const safeSoc = Utils.clamp(Utils.safeParseFloat(soc, 0), 0, 100);
        batteryFill.style.width = safeSoc + '%';

        let text = '';
        let gradient = '';

        if (safeSoc > 70) {
            text = '充足 ' + safeSoc + '%';
            gradient = 'linear-gradient(90deg, #4CAF50 0%, #8BC34A 100%)';
        } else if (safeSoc > 30) {
            text = '正常 ' + safeSoc + '%';
            gradient = 'linear-gradient(90deg, #FFC107 0%, #FFD54F 100%)';
        } else {
            text = '偏低 ' + safeSoc + '%';
            gradient = 'linear-gradient(90deg, #f44336 0%, #e57373 100%)';
        }

        batteryFill.textContent = text;
        batteryFill.style.background = gradient;
    }
};

// =========================
// 导航
// =========================
const Navigation = {
    init() {
        this.setupNavigation();
        this.setupScrollListener();
    },

    setupNavigation() {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const targetId = item.getAttribute('href').substring(1);
                const targetElement = document.getElementById(targetId);

                if (targetElement) {
                    targetElement.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                    });
                    this.updateActiveNav(targetId);
                }
            });
        });
    },

    setupScrollListener() {
        let isScrolling = false;
        window.addEventListener('scroll', () => {
            if (!isScrolling) {
                window.requestAnimationFrame(() => {
                    this.updateActiveNavByScroll();
                    isScrolling = false;
                });
                isScrolling = true;
            }
        });
    },

    updateActiveNav(targetId) {
        document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
        const activeNav = document.querySelector(`.nav-item[href="#${targetId}"]`);
        if (activeNav) activeNav.classList.add('active');
    },

    updateActiveNavByScroll() {
        const sections = ['overview', 'monitor', 'bafa-devices', 'battery', 'analysis', 'logs'];
        const scrollPosition = window.scrollY + 150;

        for (let i = sections.length - 1; i >= 0; i--) {
            const section = document.getElementById(sections[i]);
            if (section && scrollPosition >= section.offsetTop) {
                this.updateActiveNav(sections[i]);
                break;
            }
        }
    }
};

// =========================
// 图表
// =========================
const ChartManager = {
    charts: {},

    init() {
        const chartEl = document.getElementById('energyChart');
        if (!chartEl || typeof Chart === 'undefined') return;
        this.initEnergyChart();
    },

    initEnergyChart() {
        const ctx = document.getElementById('energyChart').getContext('2d');

        const labels = [];
        for (let i = 23; i >= 0; i--) {
            const hour = new Date();
            hour.setHours(hour.getHours() - i);
            labels.push(hour.getHours() + ':00');
        }

        const solarData = new Array(24).fill(0);
        const loadData = new Array(24).fill(0);

        this.charts.energy = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: '太阳能功率 (W)',
                        data: solarData,
                        borderColor: '#667eea',
                        backgroundColor: 'rgba(102,126,234,0.1)',
                        tension: 0.4,
                        fill: true
                    },
                    {
                        label: '系统负载 (W)',
                        data: loadData,
                        borderColor: '#f39c12',
                        backgroundColor: 'rgba(243,156,18,0.1)',
                        tension: 0.4,
                        fill: true
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top' },
                    tooltip: { mode: 'index', intersect: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: '功率 (W)' }
                    },
                    x: {
                        title: { display: true, text: '时间' }
                    }
                }
            }
        });
    },

    updateEnergyChart() {
        if (!this.charts.energy) return;

        const solarData = this.charts.energy.data.datasets[0].data;
        const loadData = this.charts.energy.data.datasets[1].data;

        solarData.shift();
        loadData.shift();

        solarData.push(Math.max(0, SystemState.systemData.solarPower || 0));
        loadData.push(SystemState.systemData.totalLoad || 0);

        this.charts.energy.update();
    }
};

// =========================
// 巴法云
// =========================
const BafaCloud = {
    TYPE: 1,
    SOLAR_TOPIC: 'TYN1004',
    pollTimerId: null,
    statusPollTimerId: null,
    solarPollTimerId: null,
    messageCallback: null,
    lastSolarUnix: 0,

    async sendCommand(topic, cmd) {
        try {
            LoadingManager.showLoading('发送指令中...');

            const cleanTopic = TopicUtils.normalizeTopic(topic);

            const response = await fetch('/api/bemfa-send', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    topic: cleanTopic,
                    type: this.TYPE,
                    msg: cmd
                })
            });

            const result = await response.json();
            console.log('后端转发 sendCommand 返回:', result);

            if (!response.ok || !result.ok) {
                throw new Error(result.error || '发送失败');
            }

            Logger.addLog(`✅ 指令已发送：${cleanTopic} -> ${cmd}`, 'success');
            return { success: true, result };
        } catch (error) {
            console.error('sendCommand失败:', error);
            Logger.addLog(`❌ 控制失败: ${error.message}`, 'error');
            return { success: false, error: error.message };
        } finally {
            LoadingManager.hideLoading();
        }
    },

    startPolling(callback, interval = 3000) {
        if (this.pollTimerId) return;

        this.messageCallback = callback;
        Logger.addLog('🌐 开始连接巴法云服务器...', 'info');

        this.pollMessage();
        this.pollDeviceStatus();
        this.pollSolarSnapshot();

        this.pollTimerId = setInterval(() => {
            this.pollMessage();
        }, interval);

        this.statusPollTimerId = setInterval(() => {
            this.pollDeviceStatus();
        }, 10000);

        this.solarPollTimerId = setInterval(() => {
            this.pollSolarSnapshot();
        }, 3000);

        Logger.addLog('✅ 巴法云连接成功，开始接收数据', 'success');
    },

    stopPolling() {
        if (this.pollTimerId) {
            clearInterval(this.pollTimerId);
            this.pollTimerId = null;
        }

        if (this.statusPollTimerId) {
            clearInterval(this.statusPollTimerId);
            this.statusPollTimerId = null;
        }

        if (this.solarPollTimerId) {
            clearInterval(this.solarPollTimerId);
            this.solarPollTimerId = null;
        }

        Logger.addLog('⚠️ 已断开巴法云连接', 'warning');
    },

    async pollDeviceStatus() {
        try {
            const response = await fetch('/api/bemfa-topics');
            const result = await response.json();

            if (!response.ok || !result.ok) {
                throw new Error(result.error || '获取设备状态失败');
            }

            console.log('后端转发主题状态:', result);

            if (result.data) {
                this.handleDeviceStatus(result.data);
            }
        } catch (error) {
            console.error('获取设备状态失败:', error);
        }
    },

    handleDeviceStatus(data) {
        if (!Array.isArray(data) || data.length === 0) return;

        data.forEach(item => {
            const topic = item.topic || '';
            const online = item.online || 0;
            this.updateDeviceOnlineStatus(topic, online);
        });
    },

    updateDeviceOnlineStatus(topic, online) {
        const normalizedTopic = TopicUtils.normalizeTopic(topic);
        const deviceName = DeviceStateStore.getDeviceByTopic(normalizedTopic);
        if (!deviceName) return;

        DeviceStateStore.updateDevice(deviceName, {
            online: !!Number(online)
        });

        this.renderDeviceState(deviceName);
    },

    async pollMessage() {
        try {
            const response = await fetch('/api/bemfa-message');
            const result = await response.json();

            if (!response.ok || !result.ok) {
                throw new Error(result.error || '获取消息失败');
            }

            console.log('后端转发巴法云消息:', result);

            if (result.data) {
                this.handleMessage(result.data);
            }
        } catch (error) {
            console.error('获取消息失败:', error);
        }
    },

    async pollSolarSnapshot() {
        try {
            const response = await fetch(`/api/bemfa-solar?topic=${encodeURIComponent(this.SOLAR_TOPIC)}&type=${this.TYPE}`);
            const result = await response.json();

            if (!response.ok || !result.ok) {
                throw new Error(result.error || '拉取太阳能数据失败');
            }

            console.log('后端转发太阳能快照:', result);

            const list = Array.isArray(result.data) ? result.data : [];
            if (list.length === 0) return;

            const latest = list[0];
            const msg = String(latest.msg || '').trim();
            const unix = parseInt(latest.unix || 0, 10);

            if (!msg) return;

            if (unix && unix === this.lastSolarUnix) return;
            if (unix) this.lastSolarUnix = unix;

            this.parseSensorData(msg);
        } catch (error) {
            console.error('拉取太阳能快照失败:', error);
            Logger.addLog(`❌ 拉取太阳能数据失败: ${error.message}`, 'error');
        }
    },

    handleMessage(data) {
        if (!data) return;

        const list = Array.isArray(data) ? data : [data];

        list.forEach(item => {
            const topic = String(item.topic || item.name || '').trim();
            const message = String(item.msg || item.message || item.data || '').trim();
            if (!topic) return;

            console.log('收到巴法云消息:', { topic, message, raw: item });

            const normalizedTopic = TopicUtils.normalizeTopic(topic);
            const deviceName = DeviceStateStore.getDeviceByTopic(normalizedTopic);

            if (deviceName) {
                if (message === 'on' || message === 'off') {
                    this.updateDeviceStatus(topic, message);
                    return;
                }

                if (message.includes('=') && (message.includes('current') || message.includes('status'))) {
                    this.parseKeyValueDeviceMessage(deviceName, message);
                    return;
                }
            }

            if (
                TopicUtils.isSensorTopic(topic) ||
                message.includes('SOC=') ||
                message.includes('BAT=') ||
                message.includes('CHGI=') ||
                message.includes('PVV=') ||
                message.includes('PVI=') ||
                message.includes('CPP=')
            ) {
                this.parseSensorData(message);
                return;
            }
        });

        if (this.messageCallback) {
            this.messageCallback(list);
        }
    },

    parseKeyValueDeviceMessage(deviceName, message) {
        try {
            const dataObj = {};

            message.split(',').forEach(pair => {
                const [key, value] = pair.split('=');
                if (key && value !== undefined) {
                    dataObj[key.trim()] = value.trim();
                }
            });

            const patch = {};

            if (dataObj.status !== undefined) {
                patch.status = String(dataObj.status).toLowerCase();
            }

            if (dataObj.current !== undefined) {
                patch.current = Utils.safeParseFloat(dataObj.current, 0);
            }

            DeviceStateStore.updateDevice(deviceName, patch);
            this.renderDeviceState(deviceName);
        } catch (error) {
            console.error('解析设备键值消息失败:', error);
        }
    },

    updateDeviceStatus(topic, status) {
        const normalizedTopic = TopicUtils.normalizeTopic(topic);
        const deviceName = DeviceStateStore.getDeviceByTopic(normalizedTopic);
        if (!deviceName) return;

        const normalizedStatus = String(status).trim().toLowerCase();

        DeviceStateStore.updateDevice(deviceName, {
            status: normalizedStatus
        });

        if (normalizedStatus === 'on') {
            StandbyManager.resetDeviceTimer(deviceName);
        }

        this.renderDeviceState(deviceName);
        Logger.addLog(`📩 收到${deviceName}状态更新: ${normalizedStatus}`, 'info');
    },

    renderDeviceState(deviceName) {
        console.log('renderDeviceState执行:', deviceName, DeviceStateStore.getDevice(deviceName));
        const device = DeviceStateStore.getDevice(deviceName);
        if (!device) return;

        const statusElement = document.getElementById(DeviceUIMap.statusIds[deviceName]);
        if (statusElement) {
            if (device.status === 'on') {
                statusElement.textContent = '已开启';
                statusElement.style.color = '#28a745';
            } else if (device.status === 'off') {
                statusElement.textContent = '已关闭';
                statusElement.style.color = '#dc3545';
            } else {
                statusElement.textContent = device.online ? '在线' : '离线';
                statusElement.style.color = device.online ? '#28a745' : '#999';
            }
        }

        const currentElementIds = DeviceUIMap.currentIds[deviceName] || [];
        const displayCurrent = (device.status === 'on' && device.online) ? device.current : 0;

        currentElementIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.textContent = Utils.formatNumber(displayCurrent, 2);
            }
        });
    },

    parseSensorData(message) {
        try {
            if (!message || !String(message).includes('=')) {
                console.warn('传感器消息格式无效:', message);
                return;
            }

            const dataObj = {};

            String(message).split(',').forEach(pair => {
                const [rawKey, rawValue] = pair.split('=');
                if (!rawKey || rawValue === undefined) return;

                const key = String(rawKey).trim().toUpperCase();
                const valueText = String(rawValue).trim();
                const parsed = parseFloat(valueText);

                dataObj[key] = isNaN(parsed) ? valueText : parsed;
            });

            console.log('解析后的太阳能/储能数据:', dataObj);

            ['AC1', 'AC2', 'AC3', 'AC4', 'TC1', 'TC2', 'TC3', 'TC4'].forEach(deviceName => {
                if (dataObj[deviceName] !== undefined) {
                    DeviceStateStore.updateDevice(deviceName, {
                        current: Utils.safeParseFloat(dataObj[deviceName], 0)
                    });
                    this.renderDeviceState(deviceName);
                }
            });

            this.updateMonitorData(dataObj);
            StandbyManager.checkStandbyStatus(dataObj);

            Logger.addLog('📊 收到太阳能/储能综合数据', 'info');
        } catch (error) {
            console.error('解析传感器数据失败:', error, message);
            Logger.addLog(`❌ 太阳能数据解析失败: ${error.message}`, 'error');
        }
    },

    updateMonitorData(data) {
        if (!data) return;

        const setText = (id, value, decimals = 2) => {
            const el = document.getElementById(id);
            if (!el) return;

            let v = value;
            if (decimals !== null && decimals !== undefined && !isNaN(parseFloat(value))) {
                v = parseFloat(value).toFixed(decimals);
            }

            if (el.textContent !== String(v)) {
                el.textContent = v;
            }
        };

        const setDeviceCurrent = (deviceName, value) => {
            const device = DeviceStateStore.getDevice(deviceName);
            const currentValue = (device && device.status === 'on' && device.online) ? value : 0;
            const ids = DeviceUIMap.currentIds[deviceName] || [];
            ids.forEach(id => setText(id, currentValue, 2));
        };

        if (data.AC1 !== undefined) setDeviceCurrent('AC1', data.AC1);
        if (data.AC2 !== undefined) setDeviceCurrent('AC2', data.AC2);
        if (data.AC3 !== undefined) setDeviceCurrent('AC3', data.AC3);
        if (data.AC4 !== undefined) setDeviceCurrent('AC4', data.AC4);

        if (data.TC1 !== undefined) setDeviceCurrent('TC1', data.TC1);
        if (data.TC2 !== undefined) setDeviceCurrent('TC2', data.TC2);
        if (data.TC3 !== undefined) setDeviceCurrent('TC3', data.TC3);
        if (data.TC4 !== undefined) setDeviceCurrent('TC4', data.TC4);

        if (data.SOC !== undefined) setText('soc-value', data.SOC, 0);
        if (data.BAT !== undefined) setText('bat-value', data.BAT, 1);
        if (data.CHGI !== undefined) setText('chgi-value', data.CHGI, 2);
        if (data.PVV !== undefined) setText('pvv-value', data.PVV, 1);
        if (data.PVI !== undefined) setText('pvi-value', data.PVI, 2);
        if (data.CPP !== undefined) setText('cpp-value', data.CPP, 0);

        if (data.SOC !== undefined) {
            setText('battery-soc-live', data.SOC, 0);
            setText('batterySocDisplay', data.SOC, 0);
            setText('batterySoc', data.SOC, 0);

            const percentEl = document.getElementById('batteryPercentDisplay');
            if (percentEl) percentEl.textContent = `${parseInt(data.SOC, 10)}%`;

            SystemState.systemData.batterySoc = parseFloat(data.SOC);
            BatteryManager.updateBatteryDisplay(parseFloat(data.SOC));
        }

        if (data.BAT !== undefined) {
            setText('battery-bat-live', data.BAT, 1);
            setText('batteryVoltageDisplay', data.BAT, 1);
            setText('batteryVoltage', data.BAT, 1);
            SystemState.systemData.batteryVoltage = parseFloat(data.BAT);
        }

        if (data.CHGI !== undefined) {
            setText('battery-chgi-live', data.CHGI, 2);
            setText('batteryChargeCurrentDisplay', data.CHGI, 2);
        }

        if (data.PVV !== undefined) setText('battery-pvv-live', data.PVV, 1);
        if (data.PVI !== undefined) setText('battery-pvi-live', data.PVI, 2);

        if (data.CPP !== undefined) {
            setText('battery-cpp-live', data.CPP, 0);
            setText('batteryChargePowerDisplay', data.CPP, 0);
        }

        if (data.PVV !== undefined && data.PVI !== undefined) {
            const solarPower = parseFloat(data.PVV) * parseFloat(data.PVI);
            setText('solarPower', solarPower, 0);
            SystemState.systemData.solarPower = solarPower;
        }

        const getValidCurrent = (deviceName, rawValue) => {
            const device = DeviceStateStore.getDevice(deviceName);
            return (device && device.status === 'on' && device.online) ? (rawValue || 0) : 0;
        };

        const totalLoad =
            getValidCurrent('AC1', data.AC1) * 220 +
            getValidCurrent('AC2', data.AC2) * 220 +
            getValidCurrent('AC3', data.AC3) * 220 +
            getValidCurrent('AC4', data.AC4) * 220 +
            getValidCurrent('TC1', data.TC1) * 20 +
            getValidCurrent('TC2', data.TC2) * 20 +
            getValidCurrent('TC3', data.TC3) * 20 +
            getValidCurrent('TC4', data.TC4) * 20;

        if (!isNaN(totalLoad)) {
            setText('systemLoad', totalLoad, 0);
            setText('totalLoad', totalLoad, 0);
            SystemState.systemData.totalLoad = totalLoad;
        }

        let activeCount = 0;
        if (getValidCurrent('AC1', data.AC1) > 0.1) activeCount++;
        if (getValidCurrent('AC2', data.AC2) > 0.1) activeCount++;
        if (getValidCurrent('AC3', data.AC3) > 0.1) activeCount++;
        if (getValidCurrent('AC4', data.AC4) > 0.1) activeCount++;
        if (getValidCurrent('TC1', data.TC1) > 0.1) activeCount++;
        if (getValidCurrent('TC2', data.TC2) > 0.1) activeCount++;
        if (getValidCurrent('TC3', data.TC3) > 0.1) activeCount++;
        if (getValidCurrent('TC4', data.TC4) > 0.1) activeCount++;

        setText('activeChannels', activeCount, 0);
        setText('activeChannelsOverview', activeCount, 0);

        const updateTimeEl = document.getElementById('updateTime');
        if (updateTimeEl) {
            updateTimeEl.textContent = Utils.formatDateTime();
        }
    }
};

// =========================
// 待机管理
// =========================
const StandbyManager = {
    deviceTopics: {
        AC1: 'CZ1006',
        AC2: 'CZ2006',
        AC3: 'CZ3006',
        AC4: 'CZ4006',
        TC1: 'DC2006',
        TC2: 'DC3006',
        TC3: 'DC4006',
        TC4: 'DC5006'
    },

    deviceStates: {
        AC1: { current: 0, belowThresholdSince: null, isOff: false, lastActionTime: 0, lastRecoverySlot: '' },
        AC2: { current: 0, belowThresholdSince: null, isOff: false, lastActionTime: 0, lastRecoverySlot: '' },
        AC3: { current: 0, belowThresholdSince: null, isOff: false, lastActionTime: 0, lastRecoverySlot: '' },
        AC4: { current: 0, belowThresholdSince: null, isOff: false, lastActionTime: 0, lastRecoverySlot: '' },
        TC1: { current: 0, belowThresholdSince: null, isOff: false, lastActionTime: 0, lastRecoverySlot: '' },
        TC2: { current: 0, belowThresholdSince: null, isOff: false, lastActionTime: 0, lastRecoverySlot: '' },
        TC3: { current: 0, belowThresholdSince: null, isOff: false, lastActionTime: 0, lastRecoverySlot: '' },
        TC4: { current: 0, belowThresholdSince: null, isOff: false, lastActionTime: 0, lastRecoverySlot: '' }
    },

    _schedulerTimer: null,

    getDeviceRecoveryPeriods(device) {
        const prefix = device.toLowerCase();

        const periods = [
            {
                start: document.getElementById(`${prefix}-recovery-start-1`)?.value || '',
                end: document.getElementById(`${prefix}-recovery-end-1`)?.value || ''
            },
            {
                start: document.getElementById(`${prefix}-recovery-start-2`)?.value || '',
                end: document.getElementById(`${prefix}-recovery-end-2`)?.value || ''
            },
            {
                start: document.getElementById(`${prefix}-recovery-start-3`)?.value || '',
                end: document.getElementById(`${prefix}-recovery-end-3`)?.value || ''
            }
        ];

        return periods.filter(period =>
            /^\d{2}:\d{2}$/.test(period.start) &&
            /^\d{2}:\d{2}$/.test(period.end)
        );
    },

    isCurrentTimeInPeriod(start, end, current) {
        const toMinutes = (timeStr) => {
            const [h, m] = timeStr.split(':').map(Number);
            return h * 60 + m;
        };

        const startMin = toMinutes(start);
        const endMin = toMinutes(end);
        const currentMin = toMinutes(current);

        // 普通时段
        if (startMin <= endMin) {
            return currentMin >= startMin && currentMin <= endMin;
        }

        // 跨天时段，例如 23:50 ~ 00:20
        return currentMin >= startMin || currentMin <= endMin;
    },

    toggleRecoveryTimeInputs(device) {
        const mode = document.getElementById(`${device.toLowerCase()}-recovery-mode`)?.value || 'manual';
        const group = document.getElementById(`${device.toLowerCase()}-recovery-time-group`);
        if (!group) return;

        group.style.display = mode === 'timer' ? 'block' : 'none';
    },

    initRecoveryModeUI() {
        Object.keys(this.deviceStates).forEach(device => {
            const selectEl = document.getElementById(`${device.toLowerCase()}-recovery-mode`);
            if (!selectEl) return;

            this.toggleRecoveryTimeInputs(device);

            selectEl.addEventListener('change', () => {
                this.toggleRecoveryTimeInputs(device);
            });
        });
    },

    checkStandbyStatus(data) {
        if (!data) return;

        Object.keys(this.deviceStates).forEach(device => {
            const current = Utils.safeParseFloat(data[device], 0);
            const now = Utils.now();
            const state = this.deviceStates[device];
            state.current = current;

            const enabled = document.getElementById(`${device.toLowerCase()}-standby-enabled`)?.checked || false;
            if (!enabled) {
                state.belowThresholdSince = null;
                this.updateCountdownUI(device, 0, false);
                return;
            }

            const threshold = Utils.safeParseFloat(
                document.getElementById(`${device.toLowerCase()}-current-threshold`)?.value,
                0.05
            );

            const duration = Utils.safeParseInt(
                document.getElementById(`${device.toLowerCase()}-duration`)?.value,
                120
            );

            const action = document.getElementById(`${device.toLowerCase()}-action`)?.value || 'turn_off';
            const recoveryMode = document.getElementById(`${device.toLowerCase()}-recovery-mode`)?.value || 'manual';

            // 已关闭，等待恢复时间段触发
            if (state.isOff && (recoveryMode === 'manual' || recoveryMode === 'cloud' || recoveryMode === 'timer')) {
                this.updateCountdownUI(device, 0, false);
                return;
            }

            if (current < threshold) {
                if (!state.belowThresholdSince) {
                    state.belowThresholdSince = now;
                    Logger.addLog(`⏱️ ${device} 电流低于阈值，开始计时`, 'info');
                }

                const elapsedSeconds = Math.floor((now - state.belowThresholdSince) / 1000);
                const remain = Math.max(0, duration - elapsedSeconds);
                this.updateCountdownUI(device, remain, true);

                if (elapsedSeconds >= duration && !state.isOff) {
                    this.handleStandby(device, action, recoveryMode);
                }
            } else {
                if (state.belowThresholdSince) {
                    Logger.addLog(`✅ ${device} 电流恢复正常，待机计时已重置`, 'success');
                }

                state.belowThresholdSince = null;
                this.updateCountdownUI(device, duration, false);
            }
        });
    },

    async handleStandby(device, action, recoveryMode) {
        const topic = this.deviceTopics[device];
        const state = this.deviceStates[device];
        const now = Utils.now();

        if (!topic) return;
        if (now - state.lastActionTime < 5000) return;

        if (action === 'turn_off') {
            const res = await BafaCloud.sendCommand(topic, 'off');

            if (res && res.success) {
                state.isOff = true;
                state.lastActionTime = now;
                state.belowThresholdSince = null;

                DeviceStateStore.updateDevice(device, { status: 'off' });
                BafaCloud.renderDeviceState(device);

                let modeText = '手动恢复';
                if (recoveryMode === 'timer') modeText = '时间段恢复';
                if (recoveryMode === 'cloud') modeText = '云端控制';

                Logger.addLog(`⏰ ${device} 已自动关闭，恢复方式：${modeText}`, 'warning');
            }
        } else if (action === 'alert') {
            state.lastActionTime = now;
            Logger.addLog(`⚠️ 待机提醒：${device} 电流低于阈值持续达到设定时间`, 'warning');
        }
    },

    async restoreDevice(device, isAuto = false, source = 'manual') {
        const topic = this.deviceTopics[device];
        const state = this.deviceStates[device];
        if (!topic) return;

        Logger.addLog(`🕒 ${device} 到达恢复时间段，正在发送开启指令...`, 'info');

        const res = await BafaCloud.sendCommand(topic, 'on');
        if (res && res.success) {
            state.isOff = false;
            state.belowThresholdSince = null;
            state.lastActionTime = Utils.now();

            DeviceStateStore.updateDevice(device, {
                status: 'on'
            });

            BafaCloud.renderDeviceState(device);

            let prefix = '🔄 手动恢复';
            if (isAuto && source === 'timer') prefix = '⏰ 时间段恢复';
            if (isAuto && source === 'cloud') prefix = '☁️ 云端恢复';

            Logger.addLog(`${prefix}：${device} 已开启，并已同步到巴法云平台`, 'success');
        } else {
            Logger.addLog(`❌ ${device} 恢复失败，巴法云开启指令未成功`, 'error');
        }
    },

  checkTimedRecovery() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const currentSlot = `${hh}:${mm}`;

    console.log('[恢复调度检查]', currentSlot);

    Object.keys(this.deviceStates).forEach(device => {
        const state = this.deviceStates[device];
        const recoveryMode = document.getElementById(`${device.toLowerCase()}-recovery-mode`)?.value || 'manual';
        const enabled = document.getElementById(`${device.toLowerCase()}-standby-enabled`)?.checked || false;

        console.log(`[${device}] enabled=${enabled}, recoveryMode=${recoveryMode}, isOff=${state.isOff}, lastRecoverySlot=${state.lastRecoverySlot}`);

        if (!enabled) {
            state.lastRecoverySlot = '';
            return;
        }

        if (recoveryMode !== 'timer') {
            state.lastRecoverySlot = '';
            return;
        }

        const periods = this.getDeviceRecoveryPeriods(device);
        console.log(`[${device}] 恢复时段:`, periods);

        const matchedPeriod = periods.find(period =>
            this.isCurrentTimeInPeriod(period.start, period.end, currentSlot)
        );

        console.log(`[${device}] 当前匹配时段:`, matchedPeriod);

        // 当前不在任何恢复时段内，允许后续时段重新触发
        if (!matchedPeriod) {
            state.lastRecoverySlot = '';
            return;
        }

        // 只有关闭状态才触发恢复
        if (!state.isOff) {
            console.log(`[${device}] 当前在恢复时段内，但设备不是关闭状态，不触发恢复`);
            return;
        }

        // 同一时段只触发一次
        const slotKey = `${matchedPeriod.start}-${matchedPeriod.end}`;
        if (state.lastRecoverySlot === slotKey) {
            console.log(`[${device}] 当前时段已经恢复过，不重复触发`);
            return;
        }

        console.log(`[${device}] 满足恢复条件，准备自动恢复`);
        state.lastRecoverySlot = slotKey;
        this.restoreDevice(device, true, 'timer');
    });
},

    resetDeviceTimer(device) {
        const state = this.deviceStates[device];
        if (!state) return;

        state.belowThresholdSince = null;
        state.isOff = false;
        this.updateCountdownUI(device, 0, false);
    },

    updateCountdownUI(device, seconds, active = false) {
        const el = document.getElementById(`${device.toLowerCase()}-countdown`);
        if (!el) return;

        el.textContent = Math.max(0, seconds);
        el.style.color = active ? '#dc3545' : '#666';
        el.style.fontWeight = active ? 'bold' : 'normal';
    },

    startRecoveryScheduler() {
        if (this._schedulerTimer) return;

        this.checkTimedRecovery();

        this._schedulerTimer = setInterval(() => {
            this.checkTimedRecovery();
        }, 10 * 1000);

        Logger.addLog('🕒 时间段恢复调度器已启动', 'info');
    },

    stopRecoveryScheduler() {
        if (this._schedulerTimer) {
            clearInterval(this._schedulerTimer);
            this._schedulerTimer = null;
        }
    }
};

// =========================
// 策略配置同步
// =========================
const StrategyConfigManager = {
    STORAGE_KEY: 'sun-grid-device-config-v2',

    loadAllLocalConfigs() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (error) {
            console.error('读取本地策略失败:', error);
            return {};
        }
    },

    saveAllLocalConfigs(configs) {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(configs));
        } catch (error) {
            console.error('保存本地策略失败:', error);
        }
    },

    saveDeviceConfigToLocal(deviceName) {
        const configs = this.loadAllLocalConfigs();
        const prefix = deviceName.toLowerCase();

        configs[deviceName] = {
            standbyEnabled: document.getElementById(`${prefix}-standby-enabled`)?.checked || false,
            threshold: document.getElementById(`${prefix}-current-threshold`)?.value || '',
            duration: document.getElementById(`${prefix}-duration`)?.value || '',
            action: document.getElementById(`${prefix}-action`)?.value || 'turn_off',
            recoveryMode: document.getElementById(`${prefix}-recovery-mode`)?.value || 'manual',

            start1: document.getElementById(`${prefix}-recovery-start-1`)?.value || '',
            end1: document.getElementById(`${prefix}-recovery-end-1`)?.value || '',
            start2: document.getElementById(`${prefix}-recovery-start-2`)?.value || '',
            end2: document.getElementById(`${prefix}-recovery-end-2`)?.value || '',
            start3: document.getElementById(`${prefix}-recovery-start-3`)?.value || '',
            end3: document.getElementById(`${prefix}-recovery-end-3`)?.value || ''
        };

        this.saveAllLocalConfigs(configs);
    },

    restoreDeviceConfigFromLocal(deviceName) {
        const configs = this.loadAllLocalConfigs();
        const config = configs[deviceName];
        if (!config) return;

        const prefix = deviceName.toLowerCase();

        const standbyEnabledEl = document.getElementById(`${prefix}-standby-enabled`);
        const thresholdEl = document.getElementById(`${prefix}-current-threshold`);
        const durationEl = document.getElementById(`${prefix}-duration`);
        const actionEl = document.getElementById(`${prefix}-action`);
        const recoveryModeEl = document.getElementById(`${prefix}-recovery-mode`);

        const start1El = document.getElementById(`${prefix}-recovery-start-1`);
        const end1El = document.getElementById(`${prefix}-recovery-end-1`);
        const start2El = document.getElementById(`${prefix}-recovery-start-2`);
        const end2El = document.getElementById(`${prefix}-recovery-end-2`);
        const start3El = document.getElementById(`${prefix}-recovery-start-3`);
        const end3El = document.getElementById(`${prefix}-recovery-end-3`);

        if (standbyEnabledEl) standbyEnabledEl.checked = !!config.standbyEnabled;
        if (thresholdEl && config.threshold !== '') thresholdEl.value = config.threshold;
        if (durationEl && config.duration !== '') durationEl.value = config.duration;
        if (actionEl && config.action) actionEl.value = config.action;
        if (recoveryModeEl && config.recoveryMode) recoveryModeEl.value = config.recoveryMode;

        if (start1El && config.start1) start1El.value = config.start1;
        if (end1El && config.end1) end1El.value = config.end1;
        if (start2El && config.start2) start2El.value = config.start2;
        if (end2El && config.end2) end2El.value = config.end2;
        if (start3El && config.start3) start3El.value = config.start3;
        if (end3El && config.end3) end3El.value = config.end3;
    },

    restoreAllConfigsFromLocal() {
        ['AC1', 'AC2', 'AC3', 'AC4', 'TC1', 'TC2', 'TC3', 'TC4'].forEach(device => {
            this.restoreDeviceConfigFromLocal(device);
        });
    },

    async syncDeviceConfig(deviceName) {
        try {
            const topicMap = {
                AC1: 'CZ1006_config',
                AC2: 'CZ2006_config',
                AC3: 'CZ3006_config',
                AC4: 'CZ4006_config',
                TC1: 'DC2006_config',
                TC2: 'DC3006_config',
                TC3: 'DC4006_config',
                TC4: 'DC5006_config'
            };

            const prefix = deviceName.toLowerCase();

            const enabled = document.getElementById(`${prefix}-standby-enabled`)?.checked ? 1 : 0;
            const threshold = document.getElementById(`${prefix}-current-threshold`)?.value || '0.05';
            const duration = document.getElementById(`${prefix}-duration`)?.value || '120';
            const action = document.getElementById(`${prefix}-action`)?.value || 'turn_off';
            const recovery = document.getElementById(`${prefix}-recovery-mode`)?.value || 'manual';

            const start1 = document.getElementById(`${prefix}-recovery-start-1`)?.value || '';
            const end1 = document.getElementById(`${prefix}-recovery-end-1`)?.value || '';
            const start2 = document.getElementById(`${prefix}-recovery-start-2`)?.value || '';
            const end2 = document.getElementById(`${prefix}-recovery-end-2`)?.value || '';
            const start3 = document.getElementById(`${prefix}-recovery-start-3`)?.value || '';
            const end3 = document.getElementById(`${prefix}-recovery-end-3`)?.value || '';

            // 本地保存
            this.saveDeviceConfigToLocal(deviceName);

            const msg = `standby=${enabled},threshold=${threshold},duration=${duration},action=${action},recovery=${recovery},start1=${start1},end1=${end1},start2=${start2},end2=${end2},start3=${start3},end3=${end3}`;

            const topic = topicMap[deviceName];
            if (!topic) {
                Logger.addLog(`❌ ${deviceName} 未找到配置主题`, 'error');
                return;
            }

            const res = await BafaCloud.sendCommand(topic, msg);
            if (res && res.success) {
                Logger.addLog(`⚙️ ${deviceName} 时间段策略配置已同步到巴法云`, 'success');
            }
        } catch (error) {
            Logger.addLog(`❌ ${deviceName} 策略同步失败: ${error.message}`, 'error');
        }
    }
};

// =========================
// 其它模块
// =========================
const DataRefresh = {
    start() {
        setInterval(() => {
            ChartManager.updateEnergyChart();
        }, 3000);
    }
};

const EventListeners = {
    init() {
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                ChartManager.updateEnergyChart();
            }
        });
    }
};

// =========================
// 初始化
// =========================
function initSystem() {
    console.log('阳光智网系统初始化...');
    Navigation.init();
    EventListeners.init();
    ChartManager.init();
    DataRefresh.start();

    StandbyManager.startRecoveryScheduler();
    StandbyManager.initRecoveryModeUI();
    StrategyConfigManager.restoreAllConfigsFromLocal();

    Logger.addLog('✅ 系统初始化完成，所有功能正常', 'success');
}

document.addEventListener('DOMContentLoaded', function () {
    initSystem();

    setTimeout(() => {
        BafaCloud.startPolling(function (data) {
            console.log('巴法云数据更新:', data);
        }, 3000);
    }, 1500);
});

window.addEventListener('beforeunload', function () {
    BafaCloud.stopPolling();
    StandbyManager.stopRecoveryScheduler();
});

// =========================
// 全局函数
// =========================
window.filterLogs = function (type, event) {
    Logger.filterLogs(type, event);
};

window.restoreDevice = function (device) {
    StandbyManager.restoreDevice(device, false, 'manual');
};

window.controlDevice = async function (deviceName, action) {
    const device = DeviceStateStore.getDevice(deviceName);
    if (!device) {
        Logger.addLog(`❌ 未找到设备 ${deviceName}`, 'error');
        return;
    }

    const cmd = action === 'on' ? 'on' : 'off';
    const res = await BafaCloud.sendCommand(device.topic, cmd);

    if (res && res.success) {
        DeviceStateStore.updateDevice(deviceName, { status: cmd });
        BafaCloud.renderDeviceState(deviceName);

        const standbyState = StandbyManager.deviceStates[deviceName];
        if (standbyState) {
            if (cmd === 'on') {
                standbyState.isOff = false;
                standbyState.belowThresholdSince = null;
                standbyState.lastActionTime = Utils.now();
                standbyState.lastRecoverySlot = '';
                StandbyManager.resetDeviceTimer(deviceName);
            } else {
                // 手动关闭后，也允许进入时间段恢复逻辑
                standbyState.isOff = true;
                standbyState.belowThresholdSince = null;
                standbyState.lastActionTime = Utils.now();
            }
        }

        Logger.addLog(`🎛️ ${deviceName} 已手动${cmd === 'on' ? '开启' : '关闭'}`, 'info');
    } else {
        Logger.addLog(`❌ ${deviceName} 手动${cmd === 'on' ? '开启' : '关闭'}失败`, 'error');
    }
};