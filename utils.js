// utils.js

/**
 * 格式化为 TSV (Excel 兼容)
 * @param {Array<Object>} dataArray - 对象数组
 * @returns {string} - TSV 字符串
 */
function formatForExcel(dataArray) {
    if (dataArray.length === 0) return '';
    
    // 获取所有字段的并集
    const allHeaders = new Set();
    dataArray.forEach(obj => Object.keys(obj).forEach(key => allHeaders.add(key)));
    const headers = Array.from(allHeaders);
    
    const rows = dataArray.map(obj => {
        return headers.map(header => {
            let value = obj[header] || '';
            // 清洗：去除换行，将双引号转义
            // 1. 转为字符串
            value = String(value);
            // 2. 将所有换行符替换为空格
            value = value.replace(/[\r\n]+/g, ' ');
            // 3. 将双引号转义为两个双引号 (Excel CSV/TSV 标准)
            value = value.replace(/"/g, '""');
            // 4. 如果内容包含制表符，也需要替换，避免列错位
            value = value.replace(/\t/g, '    ');
            
            // 5. 始终用双引号包裹，确保安全
            return `"${value}"`; 
        }).join('\t'); // Tab 分隔
    });

    return [headers.join('\t'), ...rows].join('\n');
}
