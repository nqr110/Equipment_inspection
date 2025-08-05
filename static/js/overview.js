// 全局变量
let inspectionData = {};
let updateInterval = null;
let socket = null;
let isOnline = true;

// 页面加载完成后初始化
document.addEventListener("DOMContentLoaded", function () {
    loadInspectionData();
    initWebSocket();
    
    // 每5秒刷新一次数据作为备用
    updateInterval = setInterval(loadInspectionData, 5000);
});

// 初始化WebSocket连接
function initWebSocket() {
    if (socket) return;
    
    // 使用Socket.IO连接到主服务器
    socket = io('/inspection');
    
    socket.on('connect', function () {
        console.log("观赏页面WebSocket连接已建立");
        isOnline = true;
    });
    
    socket.on('inspection_update', function (data) {
        console.log("观赏页面收到实时更新:", data);
        if (data.type === "full_update") {
            inspectionData = data.payload;
            updateUI();
        }
    });
    
    socket.on('disconnect', function () {
        console.log("观赏页面WebSocket连接已关闭");
        socket = null;
        isOnline = false;
        // 尝试重新连接
        setTimeout(initWebSocket, 3000);
    });
    
    socket.on('connect_error', function (error) {
        console.error("观赏页面WebSocket错误:", error);
        isOnline = false;
    });
}

// 加载检查单数据
function loadInspectionData() {
    fetch("/api/inspection")
        .then((response) => response.json())
        .then((data) => {
            inspectionData = data;
            updateUI();
        })
        .catch((error) => {
            console.error("加载数据失败:", error);
            showErrorState();
        });
}

// 更新UI
function updateUI() {
    updateStats();
    updateProgress();
    updateItems();
    updateTimeInfo();
}

// 更新统计信息
function updateStats() {
    const items = inspectionData.items || [];
    const totalItems = items.length;
    const completedItems = items.filter(item => item.status === 'completed').length;
    const pendingItems = items.filter(item => item.status === 'pending').length;
    
    document.getElementById("total-items").textContent = totalItems;
    document.getElementById("completed-items").textContent = completedItems;
    document.getElementById("pending-items").textContent = pendingItems;
    
    // 添加数字变化动画
    animateNumberChange("total-items", totalItems);
    animateNumberChange("completed-items", completedItems);
    animateNumberChange("pending-items", pendingItems);
}

// 数字变化动画
function animateNumberChange(elementId, newValue) {
    const element = document.getElementById(elementId);
    const currentValue = parseInt(element.textContent) || 0;
    
    if (currentValue !== newValue) {
        element.style.transform = "scale(1.1)";
        element.style.color = "#2ea44f";
        
        setTimeout(() => {
            element.style.transform = "scale(1)";
            element.style.color = "#24292e";
        }, 300);
    }
}

// 更新进度条
function updateProgress() {
    const items = inspectionData.items || [];
    const totalItems = items.length;
    const completedItems = items.filter(item => item.status === 'completed').length;
    
    const progressPercentage = totalItems > 0 ? (completedItems / totalItems) * 100 : 0;
    
    const progressFill = document.getElementById("progress-fill");
    const completionRate = document.getElementById("completion-rate");
    const progressDetail = document.getElementById("progress-detail");
    
    progressFill.style.width = `${progressPercentage}%`;
    completionRate.textContent = `${progressPercentage.toFixed(1)}%`;
    progressDetail.textContent = `${completedItems}/${totalItems}`;
    
    // 根据完成度改变进度条颜色
    if (progressPercentage >= 100) {
        progressFill.style.background = "linear-gradient(90deg, #2ea44f, #2c974b)";
    } else if (progressPercentage >= 50) {
        progressFill.style.background = "linear-gradient(90deg, #0969da, #0858b9)";
    } else {
        progressFill.style.background = "linear-gradient(90deg, #7d5c00, #6b4c00)";
    }
}

// 更新检查项详情
function updateItems() {
    const itemsGrid = document.getElementById("items-grid");
    const items = inspectionData.items || [];
    
    if (items.length === 0) {
        itemsGrid.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📋</div>
                <div class="empty-state-text">暂无检查项</div>
            </div>
        `;
        return;
    }
    
    itemsGrid.innerHTML = items.map(item => createItemCard(item)).join('');
}

// 创建检查项卡片
function createItemCard(item) {
    const statusText = getStatusText(item.status);
    const statusClass = `item-status ${item.status}`;
    const cardClass = `item-card ${item.status}`;
    
    const completedBy = item.completed_by || "未指定";
    const completedAt = item.completed_at || "未完成";
    
    return `
        <div class="${cardClass}">
            <div class="item-header">
                <div class="item-name">${escapeHtml(item.name)}</div>
                <div class="${statusClass}">${statusText}</div>
            </div>
            <div class="item-details">
                <div class="item-detail">
                    <div class="item-detail-label">完成人</div>
                    <div class="item-detail-value ${!item.completed_by ? 'empty' : ''}">${escapeHtml(completedBy)}</div>
                </div>
                <div class="item-detail">
                    <div class="item-detail-label">完成时间</div>
                    <div class="item-detail-value ${!item.completed_at ? 'empty' : ''}">${formatTime(completedAt)}</div>
                </div>
            </div>
        </div>
    `;
}

// 更新时间信息
function updateTimeInfo() {
    document.getElementById("created-at").textContent = formatTime(inspectionData.created_at) || "-";
    document.getElementById("updated-at").textContent = formatTime(inspectionData.updated_at) || "-";
    
    const statusElement = document.getElementById("overall-status");
    const status = inspectionData.overall_status || "in_progress";
    statusElement.textContent = getStatusText(status);
    statusElement.className = `status-${status}`;
}

// 获取状态文本
function getStatusText(status) {
    const statusMap = {
        pending: "待检查",
        completed: "已完成",
        in_progress: "进行中"
    };
    return statusMap[status] || status;
}

// 格式化时间
function formatTime(timeString) {
    if (!timeString || timeString === "未完成" || timeString === "未指定") {
        return timeString;
    }
    
    try {
        const date = new Date(timeString);
        return date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    } catch (error) {
        return timeString;
    }
}

// HTML转义
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 显示错误状态
function showErrorState() {
    const itemsGrid = document.getElementById("items-grid");
    itemsGrid.innerHTML = `
        <div class="empty-state">
            <div class="empty-state-icon">⚠️</div>
            <div class="empty-state-text">数据加载失败，请检查网络连接</div>
        </div>
    `;
}

// 页面卸载时清理定时器
window.addEventListener('beforeunload', function() {
    if (updateInterval) {
        clearInterval(updateInterval);
    }
    if (socket) {
        socket.disconnect();
    }
});

// 添加一些视觉效果
function addVisualEffects() {
    // 为统计卡片添加点击效果
    document.querySelectorAll('.stat-card').forEach(card => {
        card.addEventListener('click', function() {
            this.style.transform = 'scale(0.95)';
            setTimeout(() => {
                this.style.transform = 'scale(1)';
            }, 150);
        });
    });
    
    // 为检查项卡片添加点击效果
    document.addEventListener('click', function(e) {
        if (e.target.closest('.item-card')) {
            const card = e.target.closest('.item-card');
            card.style.transform = 'scale(0.98)';
            setTimeout(() => {
                card.style.transform = 'translateY(-2px)';
            }, 150);
        }
    });
}

// 初始化视觉效果
setTimeout(addVisualEffects, 1000); 