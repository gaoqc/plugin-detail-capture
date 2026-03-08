// offscreen.js

console.log("CWS Data Pro Offscreen Script Loaded");

// 监听来自 background 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "parse") {
        const result = handleParseHtml(request.html, request.url, request.mode, request.isMhtml);
        sendResponse(result);
        return false;
    }
});

function handleParseHtml(htmlContent, url, mode, isMhtml) {
    try {
        console.log("Parsing content for URL:", url, "Mode:", mode, "isMhtml:", isMhtml);
        
        let htmlToParse = htmlContent;
        
        // 如果是 MHTML，尝试提取 HTML 部分
        // MHTML 是 multipart 格式，通常包含 headers 和 boundary
        // 我们寻找 Content-Type: text/html 之后的内容
        if (isMhtml) {
            // 简单的启发式提取：
            // 1. 找到 "Content-Type: text/html"
            // 2. 找到随后的空行 (header 结束)
            // 3. 提取直到下一个 boundary 或者文件结束
            // 或者：直接丢给 DOMParser，它通常能容忍之前的 garbage headers
            
            // 为了更准确，尝试找到主要内容
            // MHTML 中 HTML 通常是被 quoted-printable 编码的，或者 binary
            // Chrome saveAsMHTML 通常是 Quoted-Printable
            // 我们需要解码吗？DOMParser 可能无法处理 QP 编码
            
            // 实际上，chrome.pageCapture.saveAsMHTML 保存的是完整的 snapshot
            // 直接用 DOMParser 解析 MHTML 字符串可能会失败，因为包含 MIME headers
            // 但浏览器可能足够聪明忽略它们？
            
            // 让我们尝试提取 <html>...</html> 标签内的内容
            const htmlMatch = htmlContent.match(/<html[\s\S]*<\/html>/i);
            if (htmlMatch) {
                htmlToParse = htmlMatch[0];
                // MHTML 中的 HTML 可能会有 =3D 这样的 QP 编码
                // 简单的解码：
                // =3D -> =
                // =\r\n -> (空) (软换行)
                htmlToParse = htmlToParse.replace(/=\r\n/g, '').replace(/=\n/g, '').replace(/=3D/g, '=');
            }
        }

        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlToParse, 'text/html');
        
        let data = [];
        if (mode === "detail") {
            data = extractDetail(doc, url);
        } else if (mode === "list") {
            data = extractList(doc, url);
        }

        if (data.length > 0) {
            const tsv = formatForExcel(data);
            
            const textArea = document.getElementById('clipboard-target');
            textArea.value = tsv;
            textArea.select();
            document.execCommand('copy'); 
            
            return { success: true, count: data.length };
        } else {
            return { success: false, error: "No data extracted" };
        }
    } catch (error) {
        console.error("Parse error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * 辅助函数：查找包含特定文本的元素
 */
function findElementByText(doc, selector, textPatterns) {
    const elements = doc.querySelectorAll(selector);
    for (const el of elements) {
        for (const pattern of textPatterns) {
            if (el.textContent.includes(pattern)) {
                return el;
            }
        }
    }
    return null;
}

/**
 * 辅助函数：查找紧邻的文本内容（用于 Key-Value 对）
 */
function findValueByLabel(doc, labelPatterns) {
    const candidates = Array.from(doc.querySelectorAll('div, span, h1, h2, h3, h4, h5, h6, p, label'));
    const labelEl = candidates.find(el => {
        return labelPatterns.some(pattern => el.textContent.trim() === pattern || (el.textContent.includes(pattern) && el.textContent.length < 50));
    });

    if (labelEl) {
        if (labelEl.nextElementSibling) {
            return labelEl.nextElementSibling.textContent.trim();
        }
        if (labelEl.parentElement && labelEl.parentElement.nextElementSibling) {
            return labelEl.parentElement.nextElementSibling.textContent.trim();
        }
    }
    return '';
}

/**
 * 提取详情页数据
 */
function extractDetail(doc, currentUrl) {
    console.log("开始提取详情页数据...");
    const data = {};

    // 1. 插件名称 (h1)
    const nameEl = doc.querySelector('h1');
    data['插件名称'] = nameEl ? nameEl.textContent.trim() : doc.title.split('-')[0].trim();

    // 2. 星级评分 (aria-label="4.8 stars")
    const ratingEl = doc.querySelector('[aria-label*="stars"], [aria-label*="星"]');
    if (ratingEl) {
        const match = ratingEl.getAttribute('aria-label').match(/([\d.]+)/);
        data['星级评分'] = match ? match[1] : '';
    } else {
        // 尝试文本匹配 "4.5 / 5"
        const ratingTextEl = findElementByText(doc, 'span, div', ['/ 5']);
        data['星级评分'] = ratingTextEl ? ratingTextEl.textContent.trim().split('/')[0].trim() : '';
    }

    // 3. 评分人数
    const ratingCountEl = findElementByText(doc, 'span, div, a', ['ratings', '个评分', '份评分']);
    if (ratingCountEl) {
        const match = ratingCountEl.textContent.match(/([\d,]+)/);
        data['评分人数'] = match ? match[1].replace(/,/g, '') : '';
    } else {
        data['评分人数'] = '';
    }

    // 4. 安装人数
    const userEl = findElementByText(doc, 'span, div', ['users', '位用户', 'users', 'Users']);
    if (userEl) {
        const text = userEl.textContent;
        const match = text.match(/([\d,]+\+?)/);
        data['安装人数'] = match ? match[1] : text.trim();
    } else {
        data['安装人数'] = '';
    }

    // 5. 分类
    const breadcrumbs = doc.querySelectorAll('nav ol li, nav ul li, [aria-label="Breadcrumb"] li');
    if (breadcrumbs.length > 0) {
        const cats = Array.from(breadcrumbs).map(el => el.textContent.trim()).filter(t => t !== 'Home' && t !== '首页');
        data['分类'] = cats.length > 0 ? cats[cats.length - 1] : '';
    } else {
        const catLink = doc.querySelector('a[href*="/category/"]');
        data['分类'] = catLink ? catLink.textContent.trim() : '';
    }

    // 6. Overview (简介)
    const metaDesc = doc.querySelector('meta[name="description"]');
    let overview = metaDesc ? metaDesc.content.trim() : '';
    data['Overview'] = overview;

    // 7. 版本/更新日期
    data['更新日期'] = findValueByLabel(doc, ['Updated', '更新日期', 'Last updated']);
    data['版本'] = findValueByLabel(doc, ['Version', '版本']);

    // 8. 商店链接
    data['商店链接'] = currentUrl;
    
    // 9. 开发者 (可选)
    let developer = '';
    const devEl = findElementByText(doc, 'div, span, a', ['Offered by', '提供方']);
    if (devEl) {
        developer = devEl.textContent.replace('Offered by', '').replace('提供方', '').trim();
    }
    data['开发者'] = developer;

    console.log("详情页数据: ", data);
    return [data];
}

/**
 * 提取列表页数据
 */
function extractList(doc, currentUrl) {
    console.log("开始提取列表页数据...");
    const dataList = [];
    
    // 尝试定位卡片
    let cards = Array.from(doc.querySelectorAll('div[role="listitem"]'));
    
    if (cards.length === 0) {
        const detailLinks = doc.querySelectorAll('a[href*="/detail/"]');
        const uniqueCards = new Set();
        
        detailLinks.forEach(link => {
            let parent = link.parentElement;
            let found = false;
            for (let i = 0; i < 5; i++) {
                if (!parent) break;
                if (parent.querySelector('h2')) {
                    uniqueCards.add(parent);
                    found = true;
                    break;
                }
                parent = parent.parentElement;
            }
            if (!found && link.querySelector('h2')) {
                uniqueCards.add(link);
            }
        });
        cards = Array.from(uniqueCards);
    }

    console.log(`找到 ${cards.length} 个可能的卡片`);

    cards.forEach(card => {
        const item = {};
        
        // 1. 插件名称
        const titleEl = card.querySelector('h2') || card.querySelector('h3');
        if (!titleEl) return;
        item['插件名称'] = titleEl.textContent.trim();
        
        // 2. 商店链接
        const linkEl = card.querySelector('a[href*="/detail/"]') || (card.tagName === 'A' ? card : null);
        if (linkEl) {
            const href = linkEl.getAttribute('href');
            let url = href;
            if (href.startsWith('/')) {
                const origin = new URL(currentUrl).origin;
                url = origin + href;
            }
            item['商店链接'] = url;
        } else {
            item['商店链接'] = '';
        }
        
        // 3. 星级评分
        const ratingEl = card.querySelector('[aria-label*="stars"], [aria-label*="星"]');
        if (ratingEl) {
            const match = ratingEl.getAttribute('aria-label').match(/([\d.]+)/);
            item['星级评分'] = match ? match[1] : '';
        } else {
             const ratingText = card.textContent.match(/([\d.]+)\s*\/\s*5/);
             item['星级评分'] = ratingText ? ratingText[1] : '';
        }
        
        // 4. 安装人数
        const cardText = card.textContent;
        const userMatch = cardText.match(/([\d,]+\+?)\s*(users|位用户)/i);
        item['安装人数'] = userMatch ? userMatch[1] : '';
        
        // 5. 评分人数 (列表页通常没有，留空)
        item['评分人数'] = '';
        
        // 6. Overview (列表页通常只有短描述)
        item['Overview'] = '';

        dataList.push(item);
    });
    
    console.log("列表页数据: ", dataList);
    return dataList;
}
