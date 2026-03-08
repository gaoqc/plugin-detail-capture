// background.js

let creatingOffscreen;

async function ensureOffscreenDocument() {
    const hasDocument = await chrome.offscreen.hasDocument();
    if (hasDocument) {
        return;
    }

    if (creatingOffscreen) {
        await creatingOffscreen;
        return;
    }

    creatingOffscreen = chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['DOM_PARSER', 'CLIPBOARD'],
        justification: 'Parse CWS page content and write to clipboard'
    });

    try {
        await creatingOffscreen;
    } finally {
        creatingOffscreen = null;
    }
}

function showNotification(title, message, isError = false) {
    chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon.png', 
        title: title,
        message: message,
        priority: 2,
        iconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' 
    });
}

chrome.action.onClicked.addListener(async (tab) => {
    if (!tab.url.includes("chromewebstore.google.com")) {
        showNotification("错误", "请在 Chrome 网上应用店页面使用此插件。", true);
        return;
    }

    try {
        await ensureOffscreenDocument();
    } catch (err) {
        console.error("Failed to create offscreen document", err);
        if (!err.message.includes("Only a single offscreen document")) {
            showNotification("系统错误", "无法初始化后台解析服务: " + err.message, true);
            return;
        }
    }

    const isDetail = tab.url.includes("/detail/");
    const mode = isDetail ? "detail" : "list";

    // 方案 E: 使用 chrome.pageCapture.saveAsMHTML
    // 这是一个专门用于"另存为网页"的 API，通常权限比 debugger 更宽松，且专用于获取页面内容
    try {
        console.log("Capturing page as MHTML:", tab.id);
        
        chrome.pageCapture.saveAsMHTML({tabId: tab.id}, async (blob) => {
            if (chrome.runtime.lastError) {
                console.error("saveAsMHTML failed:", chrome.runtime.lastError);
                showNotification("提取失败", "无法捕获页面: " + chrome.runtime.lastError.message, true);
                return;
            }
            
            if (!blob) {
                showNotification("提取失败", "捕获的页面内容为空", true);
                return;
            }

            // 将 Blob 转换为文本 (MHTML 格式)
            const mhtml = await blob.text();
            console.log("Got MHTML content, length:", mhtml.length);

            // 发送 MHTML 给 Offscreen 处理
            chrome.runtime.sendMessage({
                action: "parse",
                html: mhtml, // 此时发送的是 MHTML 字符串
                url: tab.url,
                mode: mode,
                isMhtml: true // 标记为 MHTML
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error("Error communicating with offscreen:", chrome.runtime.lastError);
                    showNotification("提取失败", "后台通信错误: " + chrome.runtime.lastError.message, true);
                } else if (response && response.success) {
                    showNotification("提取成功", `已提取 ${response.count} 条数据并复制到剪贴板！`);
                    
                    // 设置角标提示
                    chrome.action.setBadgeText({text: 'OK', tabId: tab.id});
                    chrome.action.setBadgeBackgroundColor({color: '#4CAF50', tabId: tab.id});
                    
                    // 3秒后清除角标
                    setTimeout(() => {
                        chrome.action.setBadgeText({text: '', tabId: tab.id});
                    }, 3000);
                } else {
                    const errorMsg = response && response.error ? response.error : "未知错误";
                    showNotification("提取失败", errorMsg, true);
                }
                
                // 关闭 Offscreen 文档，确保下次重新创建，避免状态残留
                chrome.offscreen.closeDocument().catch((err) => console.log("Failed to close offscreen document:", err));
            });
        });

    } catch (err) {
        console.error("Unexpected error in capture:", err);
        showNotification("提取失败", "系统错误: " + err.message, true);
        // 尝试关闭 Offscreen 文档
        chrome.offscreen.closeDocument().catch(() => {});
    }
});
