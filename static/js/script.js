// 全局变量
let currentUserId = null;
let inspectionData = {};
let isOnline = true;
let socket = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 3000; // 3秒

// 页面加载完成后初始化
document.addEventListener("DOMContentLoaded", function () {
  checkNetworkStatus();
  initWebSocket();
  loadInspectionData();
  bindEvents();

  // 定期检查网络状态
  setInterval(checkNetworkStatus, 5000);
});

// 检查网络状态
function checkNetworkStatus() {
  const wasOnline = isOnline;
  isOnline = navigator.onLine;

  if (wasOnline !== isOnline) {
    const statusElement = document.getElementById("network-status");
    if (isOnline) {
      statusElement.textContent = "在线";
      statusElement.className = "status-online";
      initWebSocket();
      syncLocalChanges();
    } else {
      statusElement.textContent = "离线";
      statusElement.className = "status-offline";
      if (socket) {
        socket.close();
      }
    }
  }
}

// 初始化WebSocket连接
function initWebSocket() {
  if (!isOnline || socket) return;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  socket = new WebSocket(
    `${protocol}//${host}/inspection`
  );

  socket.onopen = function () {
    reconnectAttempts = 0;
    console.log("WebSocket连接已建立");
  };

  socket.onmessage = function (event) {
    console.log("收到WebSocket消息:", event.data);
    try {
      const data = JSON.parse(event.data);
      if (data.type === "inspection_update") {
        console.log("解析后的检查数据:", data.payload);
        inspectionData = data.payload;
        updateUI();
      }
    } catch (error) {
      console.error("解析WebSocket消息失败:", error);
    }
  };

  socket.onclose = function () {
    console.log("WebSocket连接已关闭");
    if (isOnline && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      setTimeout(initWebSocket, RECONNECT_DELAY);
    }
  };

  socket.onerror = function (error) {
    console.error("WebSocket错误:", error);
  };
}

// 从本地存储加载数据
function loadFromLocalStorage() {
  const localData = localStorage.getItem("inspectionData");
  if (localData) {
    const data = JSON.parse(localData);
    // 离线时初始化所有检查项状态为"待检查"
    if (data.items) {
      data.items.forEach((item) => {
        item.status = "pending";
        item.completed_by = "";
        item.completed_at = "";
      });
      data.overall_status = "in_progress";
    }
    return data;
  }
  return null;
}

// 保存数据到本地存储
function saveToLocalStorage(data) {
  localStorage.setItem("inspectionData", JSON.stringify(data));
}

// 同步本地更改到服务器
function syncLocalChanges() {
  const localData = loadFromLocalStorage();
  if (localData && isOnline) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: "sync_local_changes",
          payload: localData,
        })
      );
    } else {
      fetch("/api/inspection", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(localData),
      })
        .then((response) => response.json())
        .then((data) => {
          if (data.success) {
            localStorage.removeItem("inspectionData");
            loadInspectionData();
          }
        });
    }
  }
}

// 加载检查单数据
function loadInspectionData() {
  if (isOnline) {
    fetch("/api/inspection")
      .then((response) => response.json())
      .then((data) => {
        inspectionData = data;
        saveToLocalStorage(data);
        updateUI();
      })
      .catch((error) => {
        console.error("从服务器加载数据失败:", error);
        // 如果服务器请求失败，尝试从本地加载
        const localData = loadFromLocalStorage();
        if (localData) {
          inspectionData = localData;
          updateUI();
        }
      });
  } else {
    const localData = loadFromLocalStorage();
    if (localData) {
      inspectionData = localData;
      updateUI();
    } else {
      console.error("离线且无本地数据");
    }
  }
}
setInterval(loadInspectionData, 1000);
// 绑定事件
function bindEvents() {
  // 添加检查项按钮
  document.getElementById("add-item-btn").addEventListener("click", addNewItem);

  // 回车键添加检查项
  document
    .getElementById("new-item-name")
    .addEventListener("keypress", function (e) {
      if (e.key === "Enter") {
        addNewItem();
      }
    });


}

// 更新UI
function updateUI() {
  updateHeaderInfo();
  updateTable();
}

// 更新头部信息
function updateHeaderInfo() {
  document.getElementById("created-at").textContent =
    inspectionData.created_at || "";
  document.getElementById("updated-at").textContent =
    inspectionData.updated_at || "";

  const statusElement = document.getElementById("overall-status");
  const status = inspectionData.overall_status || "in_progress";

  statusElement.textContent = getStatusText(status);
  statusElement.className = `status-${status}`;
}

// 更新表格
function updateTable() {
  const tbody = document.querySelector("#inspection-table tbody");
  while (tbody.firstChild) {
    tbody.removeChild(tbody.firstChild);
  }

  if (!inspectionData.items || inspectionData.items.length === 0) {
    const row = tbody.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 5;
    cell.textContent = "暂无检查项";
    cell.style.textAlign = "center";
    cell.style.padding = "20px";
    cell.style.color = "#6c757d";
    return;
  }

  let completedCount = 0;

  inspectionData.items.forEach((item) => {
    const row = tbody.insertRow();

    // 检查项名称
    const nameCell = row.insertCell();
    nameCell.textContent = item.name;

    // 状态
    const statusCell = row.insertCell();
    const statusSpan = document.createElement("span");
    statusSpan.className = `status-${item.status}`;
    statusSpan.textContent = getStatusText(item.status);
    statusCell.appendChild(statusSpan);

    // 完成人
    const completedByCell = row.insertCell();
    completedByCell.textContent = item.completed_by || "-";

    // 完成时间
    const completedAtCell = row.insertCell();
    completedAtCell.textContent = item.completed_at || "-";

    // 操作按钮
    const actionCell = row.insertCell();
    const buttonsContainer = document.createElement("div");
    buttonsContainer.className = "action-buttons";

    if (item.status === "pending") {
      const completeBtn = document.createElement("button");
      completeBtn.className = "btn btn-complete";
      completeBtn.textContent = "完成";
      completeBtn.onclick = () => updateItemStatus(item.id, "completed");
      buttonsContainer.appendChild(completeBtn);
    } else {
      const resetBtn = document.createElement("button");
      resetBtn.className = "btn btn-complete";
      resetBtn.textContent = "重置";
      resetBtn.onclick = () => updateItemStatus(item.id, "pending");
      buttonsContainer.appendChild(resetBtn);
    }

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn btn-delete";
    deleteBtn.textContent = "删除";
    deleteBtn.onclick = () => deleteItem(item.id);
    buttonsContainer.appendChild(deleteBtn);

    actionCell.appendChild(buttonsContainer);

    // 统计已完成的数量
    if (item.status === "completed") {
      completedCount++;
    }
  });

  // 更新检查进度栏
  document.getElementById("total-items").textContent =
    inspectionData.items.length;
  document.getElementById("completed-items").textContent = completedCount;
  document.getElementById("completion-rate").textContent = `${(
    (completedCount / inspectionData.items.length) * 100 || 0
  ).toFixed(2)}%`;

  // 更新进度条填充
  const progressFill = document.getElementById("progress-fill");
  const progressPercentage =
    (completedCount / inspectionData.items.length) * 100 || 0;
  progressFill.style.width = `${progressPercentage}%`;
  progressFill.setAttribute(
    "title",
    `${completedCount}/${inspectionData.items.length}`
  );
}

// 创建操作按钮
function createActionButtons(item) {
  let buttons = "";

  if (item.status === "pending") {
    buttons += `<button class="btn btn-complete" onclick="updateItemStatus('${item.id}', 'completed')">完成</button>`;
    buttons += `<button class="btn btn-cancel" onclick="updateItemStatus('${item.id}', 'cancelled')">取消</button>`;
  } else {
    buttons += `<button class="btn btn-complete" onclick="updateItemStatus('${item.id}', 'pending')">重置</button>`;
  }

  buttons += `<button class="btn btn-delete" onclick="deleteItem('${item.id}')">删除</button>`;

  return buttons;
}

// 获取状态文本
function getStatusText(status) {
  const statusMap = {
    pending: "待检查",
    completed: "已完成",
    in_progress: "进行中",
  };
  return statusMap[status] || status;
}

// 添加新检查项
function addNewItem() {
  const nameInput = document.getElementById("new-item-name");
  const name = nameInput.value.trim();

  if (!name) {
    alert("请输入检查项名称");
    return;
  }

  if (isOnline) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: "add_item",
          payload: { name: name },
        })
      );
    } else {
      fetch("/api/inspection/item", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: name }),
      })
        .then((response) => response.json())
        .then((data) => {
          if (data.success) {
            nameInput.value = "";
            inspectionData = data.data;
            saveToLocalStorage(data.data);
            updateUI();
          } else {
            alert("添加失败，请重试");
          }
        })
        .catch((error) => {
          console.error("添加检查项失败:", error);
          // 离线处理
          handleOfflineAddItem(name);
        });
    }
  } else {
    // 离线处理
    handleOfflineAddItem(name);
  }
}

// 离线添加检查项
function handleOfflineAddItem(name) {
  const newItem = {
    id: "local-" + Date.now(),
    name: name,
    status: "pending",
    completed_by: "",
    completed_at: "",
  };

  if (!inspectionData.items) {
    inspectionData.items = [];
  }

  inspectionData.items.push(newItem);
  inspectionData.updated_at = new Date().toISOString();
  saveToLocalStorage(inspectionData);
  updateUI();
  const nameInput = document.getElementById("new-item-name");
  if (nameInput) nameInput.value = "";
  // 离线状态提示已移除
}

// 更新检查项状态
function updateItemStatus(itemId, status) {
  // 获取完成人下拉框的值
  const completerName = document.getElementById("completer-name").value;

  // 如果是完成状态，但没有选择完成人，则提示用户
  if (status === "completed" && !completerName) {
    alert("请先选择完成人");
    return;
  }

  // 使用完成人下拉框的值
  const userId = completerName;

  if (isOnline) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: "update_status",
          payload: {
            item_id: itemId,
            status: status,
            user_id: userId,
          },
        })
      );
    } else {
      fetch(`/api/inspection/item/${itemId}/status`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: status,
          user_id: userId,
        }),
      })
        .then((response) => response.json())
        .then((data) => {
          if (data.success) {
            inspectionData = data.data;
            saveToLocalStorage(data.data);
            updateUI();
          } else {
            alert("更新失败，请重试");
          }
        })
        .catch((error) => {
          console.error("更新状态失败:", error);
          // 离线处理
          handleOfflineUpdateStatus(itemId, status, userId);
        });
    }
  } else {
    // 离线处理
    handleOfflineUpdateStatus(itemId, status, userId);
  }
}

// 离线更新状态
function handleOfflineUpdateStatus(itemId, status, userId) {
  for (let item of inspectionData.items) {
    if (item.id === itemId) {
      item.status = status;
      if (status === "completed") {
        item.completed_by = userId;
        item.completed_at = new Date().toISOString();
      } else {
        item.completed_by = "";
        item.completed_at = "";
      }
      break;
    }
  }

  // 检查整体状态
  const completedItems = inspectionData.items.filter(
    (item) => item.status === "completed"
  );
  const totalItems = inspectionData.items.length;

  if (completedItems.length === totalItems) {
    inspectionData.overall_status = "completed";
  } else {
    inspectionData.overall_status = "in_progress";
  }

  inspectionData.updated_at = new Date().toISOString();
  saveToLocalStorage(inspectionData);
  updateUI();
  // 离线状态提示已移除
}

// 删除检查项
function deleteItem(itemId) {
  // 直接执行删除操作

  if (isOnline) {
    fetch(`/api/inspection/item/${itemId}`, {
      method: "DELETE",
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          inspectionData = data.data;
          saveToLocalStorage(data.data);
          updateUI();
        } else {
          alert("删除失败，请重试");
        }
      })
      .catch((error) => {
        console.error("删除检查项失败:", error);
        // 离线处理
        handleOfflineDeleteItem(itemId);
      });
  } else {
    // 离线处理
    handleOfflineDeleteItem(itemId);
  }
}

// 离线删除检查项
function handleOfflineDeleteItem(itemId) {
  inspectionData.items = inspectionData.items.filter(
    (item) => item.id !== itemId
  );
  inspectionData.updated_at = new Date().toISOString();
  saveToLocalStorage(inspectionData);
  updateUI();
  // 离线状态提示已移除
}


