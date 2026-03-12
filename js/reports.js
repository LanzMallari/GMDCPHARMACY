import { db, collection, getDocs, query, where, orderBy, Timestamp } from './firebase-config.js';
import { fetchUserData } from './auth.js';

// Check if user is logged in
const loggedInUserId = localStorage.getItem('loggedInUserId');
if (!loggedInUserId) {
    window.location.href = 'index.html';
}

let reportChart = null;
let currentDiscountFilter = 'all'; // 'all', 'seniorPWD', 'yakap'

// Cache for report data
let reportCache = {
    productSales: null,
    fastMoving: null,
    lastFetch: 0
};
const CACHE_DURATION = 60000; // 1 minute cache

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initializeReports();
    setupEventListeners();
});

async function initializeReports() {
    await loadUserData();
    updateDateTime();
    loadReportsTab();
    setupSidebar();
}

async function loadUserData() {
    const userData = await fetchUserData(loggedInUserId);
    if (userData) {
        const fullName = `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || userData.email?.split('@')[0] || 'User';
        document.getElementById('sidebarUserName').textContent = fullName;
        document.getElementById('sidebarUserEmail').textContent = userData.email || '';
        document.getElementById('welcomeUserName').textContent = fullName.split(' ')[0] || 'User';
    }
}

function updateDateTime() {
    const dateTimeElement = document.getElementById('currentDateTime');
    if (dateTimeElement) {
        const now = new Date();
        dateTimeElement.textContent = now.toLocaleString('en-US', { 
            weekday: 'short', 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric',
            hour: '2-digit', 
            minute: '2-digit',
            second: '2-digit'
        });
    }
}
setInterval(updateDateTime, 1000);

function setupSidebar() {
    const burgerBtn = document.getElementById('burgerBtn');
    const sidebar = document.querySelector('.sidebar');

    if (burgerBtn) {
        burgerBtn.addEventListener('click', () => {
            sidebar.classList.toggle('active');
            const icon = burgerBtn.querySelector('i');
            icon.classList.toggle('fa-bars');
            icon.classList.toggle('fa-times');
            
            if (sidebar.classList.contains('active') && window.innerWidth <= 768) {
                createOverlay();
            } else {
                removeOverlay();
            }
        });
    }
}

function createOverlay() {
    if (!document.querySelector('.sidebar-overlay')) {
        const overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        overlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 99;';
        document.body.appendChild(overlay);
        
        overlay.addEventListener('click', () => {
            document.querySelector('.sidebar').classList.remove('active');
            document.getElementById('burgerBtn').querySelector('i').classList.remove('fa-times');
            document.getElementById('burgerBtn').querySelector('i').classList.add('fa-bars');
            overlay.remove();
        });
    }
}

function removeOverlay() {
    const overlay = document.querySelector('.sidebar-overlay');
    if (overlay) overlay.remove();
}

// Reports Functions
async function loadReportsTab() {
    try {
        populateYearDropdown();
        
        const today = new Date();
        document.getElementById('reportMonth').value = today.getMonth().toString();
        
        // Add event listeners
        document.getElementById('reportPeriod').addEventListener('change', () => generateReport());
        document.getElementById('reportMonth').addEventListener('change', () => generateReport());
        document.getElementById('reportYear').addEventListener('change', () => generateReport());
        document.getElementById('generateReportBtn').addEventListener('click', (e) => {
            e.preventDefault();
            generateReport();
        });
        
        setTimeout(() => generateReport(), 500);
        
    } catch (error) {
        console.error("Error loading reports tab:", error);
    }
}

function populateYearDropdown() {
    const yearSelect = document.getElementById('reportYear');
    if (!yearSelect) return;
    
    const currentYear = new Date().getFullYear();
    
    yearSelect.innerHTML = '';
    
    for (let i = currentYear - 5; i <= currentYear + 1; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = i;
        if (i === currentYear) {
            option.selected = true;
        }
        yearSelect.appendChild(option);
    }
}

async function generateReport(forceRefresh = false) {
    try {
        const reportContent = document.getElementById('reportStats');
        const chartCanvas = document.getElementById('reportChart');
        const breakdownContainer = document.getElementById('productSalesBreakdown');
        const fastMovingContainer = document.getElementById('fastMovingProducts');
        
        if (!reportContent || !chartCanvas || !breakdownContainer || !fastMovingContainer) return;
        
        // Show loading indicators
        breakdownContainer.innerHTML = '<div class="loading">Loading product sales data...</div>';
        fastMovingContainer.innerHTML = '<div class="loading">Analyzing fast moving products...</div>';
        
        const selectedMonth = parseInt(document.getElementById('reportMonth')?.value || new Date().getMonth());
        const selectedYear = parseInt(document.getElementById('reportYear')?.value || new Date().getFullYear());
        const period = document.getElementById('reportPeriod')?.value || 'daily';
        
        // Check cache
        const cacheKey = `${selectedMonth}-${selectedYear}`;
        const now = Date.now();
        if (!forceRefresh && reportCache.lastFetch === cacheKey && (now - reportCache.timestamp) < CACHE_DURATION) {
            // Use cached data
            displayReportFromCache(period, selectedMonth, selectedYear);
            displayProductSalesBreakdown(reportCache.productSales, reportCache.totals);
            displayFastMovingProducts(reportCache.fastMoving);
            return;
        }
        
        const startDate = new Date(selectedYear, selectedMonth, 1);
        startDate.setHours(0, 0, 0, 0);
        
        const endDate = new Date(selectedYear, selectedMonth + 1, 1);
        endDate.setHours(0, 0, 0, 0);
        
        // Fetch all sales data in one query
        const salesQuery = query(
            collection(db, "sales"),
            where("date", ">=", Timestamp.fromDate(startDate)),
            where("date", "<", Timestamp.fromDate(endDate)),
            orderBy("date", "asc")
        );
        
        const salesSnapshot = await getDocs(salesQuery);
        
        // Process sales data
        const sales = [];
        let totalSales = 0;
        let totalTransactions = 0;
        let totalDiscountAmount = 0;
        
        salesSnapshot.forEach(doc => {
            const sale = doc.data();
            sales.push({ id: doc.id, ...sale });
            totalSales += sale.total || 0;
            totalTransactions++;
            totalDiscountAmount += sale.discountAmount || 0;
        });
        
        // Generate chart data based on period
        const { labels, data } = generateChartData(sales, period, selectedYear, selectedMonth);
        
        const averageSale = totalTransactions > 0 ? totalSales / totalTransactions : 0;
        
        // Update UI
        displayReport(period, labels, data, totalSales, totalTransactions, averageSale, totalDiscountAmount, selectedMonth, selectedYear);
        
        // Load breakdown and fast moving in parallel
        const [productSalesResult, fastMovingResult] = await Promise.all([
            processProductSalesBreakdown(salesSnapshot),
            processFastMovingProducts(selectedMonth, selectedYear)
        ]);
        
        // Cache the results
        reportCache = {
            productSales: productSalesResult.productSalesArray,
            totals: productSalesResult.totals,
            fastMoving: fastMovingResult,
            lastFetch: cacheKey,
            timestamp: now
        };
        
        displayProductSalesBreakdown(productSalesResult.productSalesArray, productSalesResult.totals);
        displayFastMovingProducts(fastMovingResult);
        
    } catch (error) {
        console.error("Error generating report:", error);
        document.getElementById('reportStats').innerHTML = '<p class="error">Error generating report</p>';
    }
}

function generateChartData(sales, period, year, month) {
    let labels = [];
    let data = [];
    
    switch(period) {
        case 'daily':
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const dailyData = new Array(daysInMonth).fill(0);
            
            sales.forEach(sale => {
                const saleDate = sale.date.toDate();
                const day = saleDate.getDate() - 1;
                if (day >= 0 && day < daysInMonth) {
                    dailyData[day] += sale.total || 0;
                }
            });
            
            labels = Array.from({ length: daysInMonth }, (_, i) => `${i + 1}`);
            data = dailyData;
            break;
            
        case 'weekly':
            const weeklyData = [0, 0, 0, 0, 0];
            
            sales.forEach(sale => {
                const saleDate = sale.date.toDate();
                const dayOfMonth = saleDate.getDate();
                const weekIndex = Math.floor((dayOfMonth - 1) / 7);
                if (weekIndex < 5) {
                    weeklyData[weekIndex] += sale.total || 0;
                }
            });
            
            labels = ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5'];
            data = weeklyData;
            break;
            
        case 'monthly':
            labels = [new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long' })];
            data = [sales.reduce((sum, sale) => sum + (sale.total || 0), 0)];
            break;
    }
    
    return { labels, data };
}

function displayReportFromCache(period, selectedMonth, selectedYear) {
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                        'July', 'August', 'September', 'October', 'November', 'December'];
    
    // Update chart title only, data will be redrawn from cache
    if (reportChart) {
        reportChart.options.plugins.title.text = `${monthNames[selectedMonth]} ${selectedYear} - ${period.charAt(0).toUpperCase() + period.slice(1)} Sales`;
        reportChart.update();
    }
}

function displayReport(period, labels, data, totalSales, totalTransactions, averageSale, totalDiscountAmount, selectedMonth, selectedYear) {
    const reportContent = document.getElementById('reportStats');
    const chartCanvas = document.getElementById('reportChart');
    
    if (!reportContent || !chartCanvas) return;
    
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                        'July', 'August', 'September', 'October', 'November', 'December'];
    
    reportContent.innerHTML = `
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-icon"><i class="fas fa-chart-line"></i></div>
                <div class="stat-info"><h3>Total Sales</h3><p>₱${totalSales.toFixed(2)}</p></div>
            </div>
            <div class="stat-card">
                <div class="stat-icon"><i class="fas fa-receipt"></i></div>
                <div class="stat-info"><h3>Transactions</h3><p>${totalTransactions}</p></div>
            </div>
            <div class="stat-card">
                <div class="stat-icon"><i class="fas fa-tags"></i></div>
                <div class="stat-info"><h3>Total Discount</h3><p>₱${totalDiscountAmount.toFixed(2)}</p></div>
            </div>
            <div class="stat-card">
                <div class="stat-icon"><i class="fas fa-calculator"></i></div>
                <div class="stat-info"><h3>Average Sale</h3><p>₱${averageSale.toFixed(2)}</p></div>
            </div>
        </div>
    `;
    
    if (reportChart) {
        reportChart.destroy();
    }
    
    const ctx = chartCanvas.getContext('2d');
    
    reportChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: period === 'daily' ? 'Daily Sales' : (period === 'weekly' ? 'Weekly Sales' : 'Monthly Sales'),
                data: data,
                backgroundColor: 'rgba(52, 152, 219, 0.7)',
                borderColor: 'rgba(52, 152, 219, 1)',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: `${monthNames[selectedMonth]} ${selectedYear} - ${period.charAt(0).toUpperCase() + period.slice(1)} Sales`
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return '₱' + context.parsed.y.toFixed(2);
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return '₱' + value;
                        }
                    }
                }
            }
        }
    });
}

async function processProductSalesBreakdown(salesSnapshot) {
    // Initialize counters
    const productSales = {
        all: {},
        seniorPWD: {},
        yakap: {}
    };
    
    const totals = {
        all: { quantity: 0, revenue: 0, originalRevenue: 0, discountAmount: 0 },
        seniorPWD: { quantity: 0, revenue: 0, originalRevenue: 0, discountAmount: 0 },
        yakap: { quantity: 0, revenue: 0, originalRevenue: 0, discountAmount: 0 }
    };
    
    salesSnapshot.forEach(doc => {
        const sale = doc.data();
        const discountType = sale.discountType || 'none';
        
        if (sale.items && Array.isArray(sale.items)) {
            sale.items.forEach(item => {
                const brandName = item.brand || item.name || 'Unknown Product';
                const genericName = item.generic || '';
                
                const productKey = genericName ? `${brandName}|${genericName}` : brandName;
                const displayName = genericName ? `${brandName} (${genericName})` : brandName;
                
                const itemOriginalRevenue = (item.price * item.quantity) || 0;
                const itemDiscountedRevenue = item.subtotal || itemOriginalRevenue;
                const itemDiscountAmount = itemOriginalRevenue - itemDiscountedRevenue;
                
                // Add to 'all'
                addToProductSales(productSales.all, productKey, brandName, genericName, displayName, item, itemOriginalRevenue, itemDiscountedRevenue, itemDiscountAmount);
                updateTotals(totals.all, item, itemOriginalRevenue, itemDiscountedRevenue, itemDiscountAmount);
                
                // Add to specific discount type
                if (discountType === 'seniorPWD') {
                    addToProductSales(productSales.seniorPWD, productKey, brandName, genericName, displayName, item, itemOriginalRevenue, itemDiscountedRevenue, itemDiscountAmount);
                    updateTotals(totals.seniorPWD, item, itemOriginalRevenue, itemDiscountedRevenue, itemDiscountAmount);
                } else if (discountType === 'yakap') {
                    addToProductSales(productSales.yakap, productKey, brandName, genericName, displayName, item, itemOriginalRevenue, itemDiscountedRevenue, itemDiscountAmount);
                    updateTotals(totals.yakap, item, itemOriginalRevenue, itemDiscountedRevenue, itemDiscountAmount);
                }
            });
        }
    });
    
    // Convert to arrays and sort
    const productSalesArray = {
        all: Object.entries(productSales.all).map(([key, data]) => ({
            key, ...data
        })).sort((a, b) => b.quantity - a.quantity),
        
        seniorPWD: Object.entries(productSales.seniorPWD).map(([key, data]) => ({
            key, ...data
        })).sort((a, b) => b.quantity - a.quantity),
        
        yakap: Object.entries(productSales.yakap).map(([key, data]) => ({
            key, ...data
        })).sort((a, b) => b.quantity - a.quantity)
    };
    
    return { productSalesArray, totals };
}

function updateTotals(totalObj, item, originalRevenue, discountedRevenue, discountAmount) {
    totalObj.quantity += item.quantity || 0;
    totalObj.originalRevenue += originalRevenue;
    totalObj.revenue += discountedRevenue;
    totalObj.discountAmount += discountAmount;
}

function addToProductSales(obj, key, brand, generic, displayName, item, originalRevenue, discountedRevenue, discountAmount) {
    if (!obj[key]) {
        obj[key] = {
            brand,
            generic,
            displayName,
            quantity: 0,
            originalRevenue: 0,
            revenue: 0,
            discountAmount: 0
        };
    }
    obj[key].quantity += item.quantity || 0;
    obj[key].originalRevenue += originalRevenue;
    obj[key].revenue += discountedRevenue;
    obj[key].discountAmount += discountAmount;
}

async function processFastMovingProducts(selectedMonth, selectedYear) {
    const startDate = new Date(selectedYear, selectedMonth, 1);
    startDate.setHours(0, 0, 0, 0);
    
    const endDate = new Date(selectedYear, selectedMonth + 1, 1);
    endDate.setHours(0, 0, 0, 0);
    
    const prevMonthStart = new Date(selectedYear, selectedMonth - 1, 1);
    prevMonthStart.setHours(0, 0, 0, 0);
    
    const prevMonthEnd = new Date(selectedYear, selectedMonth, 1);
    prevMonthEnd.setHours(0, 0, 0, 0);
    
    // Fetch current and previous month data in parallel
    const [currentMonthSnapshot, prevMonthSnapshot] = await Promise.all([
        getDocs(query(
            collection(db, "sales"),
            where("date", ">=", Timestamp.fromDate(startDate)),
            where("date", "<", Timestamp.fromDate(endDate))
        )),
        getDocs(query(
            collection(db, "sales"),
            where("date", ">=", Timestamp.fromDate(prevMonthStart)),
            where("date", "<", Timestamp.fromDate(prevMonthEnd))
        ))
    ]);
    
    const productAnalysis = {};
    
    // Process current month
    currentMonthSnapshot.forEach(doc => {
        const sale = doc.data();
        if (sale.items) {
            sale.items.forEach(item => {
                const brandName = item.brand || item.name || 'Unknown';
                const genericName = item.generic || '';
                const key = genericName ? `${brandName}|${genericName}` : brandName;
                
                if (!productAnalysis[key]) {
                    productAnalysis[key] = {
                        brand: brandName,
                        generic: genericName,
                        currentQuantity: 0,
                        prevQuantity: 0,
                        currentRevenue: 0,
                        prevRevenue: 0,
                        currentOriginalRevenue: 0,
                        currentDiscountAmount: 0
                    };
                }
                
                const itemOriginalRevenue = (item.price * item.quantity) || 0;
                const itemDiscountedRevenue = item.subtotal || itemOriginalRevenue;
                const itemDiscountAmount = itemOriginalRevenue - itemDiscountedRevenue;
                
                productAnalysis[key].currentQuantity += item.quantity || 0;
                productAnalysis[key].currentRevenue += itemDiscountedRevenue;
                productAnalysis[key].currentOriginalRevenue += itemOriginalRevenue;
                productAnalysis[key].currentDiscountAmount += itemDiscountAmount;
            });
        }
    });
    
    // Process previous month
    prevMonthSnapshot.forEach(doc => {
        const sale = doc.data();
        if (sale.items) {
            sale.items.forEach(item => {
                const brandName = item.brand || item.name || 'Unknown';
                const genericName = item.generic || '';
                const key = genericName ? `${brandName}|${genericName}` : brandName;
                
                if (!productAnalysis[key]) {
                    productAnalysis[key] = {
                        brand: brandName,
                        generic: genericName,
                        currentQuantity: 0,
                        prevQuantity: 0,
                        currentRevenue: 0,
                        prevRevenue: 0,
                        currentOriginalRevenue: 0,
                        currentDiscountAmount: 0
                    };
                }
                
                const itemOriginalRevenue = (item.price * item.quantity) || 0;
                const itemDiscountedRevenue = item.subtotal || itemOriginalRevenue;
                
                productAnalysis[key].prevQuantity += item.quantity || 0;
                productAnalysis[key].prevRevenue += itemDiscountedRevenue;
            });
        }
    });
    
    // Calculate metrics and sort
    return Object.values(productAnalysis)
        .map(p => {
            const growth = p.prevQuantity 
                ? ((p.currentQuantity - p.prevQuantity) / p.prevQuantity * 100).toFixed(1)
                : p.currentQuantity > 0 ? '100' : '0';
            const velocity = (p.currentQuantity / 30).toFixed(2);
            
            return {
                ...p,
                growth,
                velocity,
                trend: p.currentQuantity > p.prevQuantity ? 'up' : 
                       p.currentQuantity < p.prevQuantity ? 'down' : 'stable'
            };
        })
        .sort((a, b) => b.currentQuantity - a.currentQuantity);
}

async function loadProductSalesBreakdown(selectedMonth, selectedYear) {
    try {
        const container = document.getElementById('productSalesBreakdown');
        if (!container) return;
        
        const startDate = new Date(selectedYear, selectedMonth, 1);
        startDate.setHours(0, 0, 0, 0);
        
        const endDate = new Date(selectedYear, selectedMonth + 1, 1);
        endDate.setHours(0, 0, 0, 0);
        
        const salesSnapshot = await getDocs(query(
            collection(db, "sales"),
            where("date", ">=", Timestamp.fromDate(startDate)),
            where("date", "<", Timestamp.fromDate(endDate))
        ));
        
        const result = await processProductSalesBreakdown(salesSnapshot);
        displayProductSalesBreakdown(result.productSalesArray, result.totals);
        
    } catch (error) {
        console.error("Error loading product sales breakdown:", error);
        document.getElementById('productSalesBreakdown').innerHTML = '<p class="error">Error loading product sales</p>';
    }
}

function displayProductSalesBreakdown(productSalesArray, totals) {
    const container = document.getElementById('productSalesBreakdown');
    if (!container) return;
    
    const selectedData = productSalesArray[currentDiscountFilter];
    const selectedTotals = totals[currentDiscountFilter];
    
    if (!selectedData || selectedData.length === 0) {
        container.innerHTML = `
            <div class="product-sales-header">
                <h3><i class="fas fa-chart-pie"></i> Product Sales Breakdown</h3>
                <div class="filter-dropdown-container">
                    <select id="discountFilterSelect" class="discount-filter-select">
                        <option value="all" ${currentDiscountFilter === 'all' ? 'selected' : ''}>All Sales (₱${totals.all.revenue.toFixed(2)})</option>
                        <option value="seniorPWD" ${currentDiscountFilter === 'seniorPWD' ? 'selected' : ''}>Senior/PWD (₱${totals.seniorPWD.revenue.toFixed(2)})</option>
                        <option value="yakap" ${currentDiscountFilter === 'yakap' ? 'selected' : ''}>YAKAP (₱${totals.yakap.revenue.toFixed(2)})</option>
                    </select>
                </div>
            </div>
            <div class="discount-summary-card">
                <div class="summary-row">
                    <span>Total Original Price:</span>
                    <span>₱${selectedTotals?.originalRevenue.toFixed(2) || '0.00'}</span>
                </div>
                <div class="summary-row discount">
                    <span>Total Discount:</span>
                    <span>-₱${selectedTotals?.discountAmount.toFixed(2) || '0.00'}</span>
                </div>
                <div class="summary-row total">
                    <span>Total Revenue:</span>
                    <span>₱${selectedTotals?.revenue.toFixed(2) || '0.00'}</span>
                </div>
            </div>
            <p class="no-data">No product sales data for this period with the selected filter</p>
        `;
        
        setupFilterListener();
        return;
    }
    
    // Build HTML efficiently
    let html = buildProductSalesHeader(currentDiscountFilter, totals);
    html += buildDiscountSummary(selectedTotals);
    html += `<p class="total-summary">Total Items Sold: ${selectedTotals.quantity} pcs</p>`;
    html += buildProductSalesTable(selectedData, selectedTotals);
    
    container.innerHTML = html;
    setupFilterListener();
}

function buildProductSalesHeader(filter, totals) {
    const filterBadge = filter === 'seniorPWD' ? '<span class="filter-badge senior-pwd">Senior/PWD</span>' : 
                       filter === 'yakap' ? '<span class="filter-badge yakap">YAKAP</span>' : '';
    
    return `
        <div class="product-sales-header">
            <h3><i class="fas fa-chart-pie"></i> Product Sales Breakdown ${filterBadge}</h3>
            <div class="filter-dropdown-container">
                <select id="discountFilterSelect" class="discount-filter-select">
                    <option value="all" ${filter === 'all' ? 'selected' : ''}>All Sales (₱${totals.all.revenue.toFixed(2)})</option>
                    <option value="seniorPWD" ${filter === 'seniorPWD' ? 'selected' : ''}>Senior/PWD (₱${totals.seniorPWD.revenue.toFixed(2)})</option>
                    <option value="yakap" ${filter === 'yakap' ? 'selected' : ''}>YAKAP (₱${totals.yakap.revenue.toFixed(2)})</option>
                </select>
            </div>
        </div>
    `;
}

function buildDiscountSummary(totals) {
    return `
        <div class="discount-summary-card">
            <div class="summary-row">
                <span>Total Original Price:</span>
                <span>₱${totals.originalRevenue.toFixed(2)}</span>
            </div>
            <div class="summary-row discount">
                <span>Total Discount:</span>
                <span>-₱${totals.discountAmount.toFixed(2)}</span>
            </div>
            <div class="summary-row total">
                <span>Total Revenue:</span>
                <span>₱${totals.revenue.toFixed(2)}</span>
            </div>
        </div>
    `;
}

function buildProductSalesTable(data, totals) {
    let rows = '';
    data.forEach(product => {
        const percentage = totals.revenue > 0 ? ((product.revenue / totals.revenue) * 100).toFixed(1) : 0;
        const genericDisplay = product.generic || '—';
        rows += `
            <tr>
                <td><strong>${escapeHtml(product.brand)}</strong></td>
                <td>${escapeHtml(genericDisplay)}</td>
                <td><strong>${product.quantity}</strong> pcs</td>
                <td>₱${product.originalRevenue.toFixed(2)}</td>
                <td class="discount-cell">-₱${product.discountAmount.toFixed(2)}</td>
                <td class="revenue-cell">₱${product.revenue.toFixed(2)}</td>
                <td class="percentage-cell">${percentage}%</td>
            </tr>
        `;
    });
    
    return `
        <div class="product-sales-table-container">
            <table class="product-sales-table">
                <thead>
                    <tr>
                        <th>Brand Name</th>
                        <th>Generic Name</th>
                        <th>Qty</th>
                        <th>Original Price</th>
                        <th>Discount</th>
                        <th>Total Revenue</th>
                        <th>%</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function setupFilterListener() {
    const filterSelect = document.getElementById('discountFilterSelect');
    if (filterSelect) {
        // Remove existing listener to prevent duplicates
        filterSelect.removeEventListener('change', handleFilterChange);
        filterSelect.addEventListener('change', handleFilterChange);
    }
}

function handleFilterChange(e) {
    currentDiscountFilter = e.target.value;
    if (reportCache.productSales && reportCache.totals) {
        displayProductSalesBreakdown(reportCache.productSales, reportCache.totals);
    }
}

async function loadFastMovingProducts(selectedMonth, selectedYear) {
    try {
        const container = document.getElementById('fastMovingProducts');
        if (!container) return;
        
        const products = await processFastMovingProducts(selectedMonth, selectedYear);
        displayFastMovingProducts(products);
        
    } catch (error) {
        console.error("Error loading fast moving products:", error);
        document.getElementById('fastMovingProducts').innerHTML = '<p class="error">Error analyzing fast moving products</p>';
    }
}

function displayFastMovingProducts(products) {
    const container = document.getElementById('fastMovingProducts');
    if (!container) return;
    
    if (products.length === 0) {
        container.innerHTML = `
            <div class="fast-moving-header">
                <h3><i class="fas fa-rocket"></i> Fast Moving Products</h3>
            </div>
            <p class="no-data">No sales data available for analysis</p>
        `;
        return;
    }
    
    const topProducts = products.slice(0, 20);
    
    let rows = '';
    topProducts.forEach((product, index) => {
        const trendIcon = product.trend === 'up' ? '↑' : product.trend === 'down' ? '↓' : '→';
        const trendClass = product.trend === 'up' ? 'trend-up' : product.trend === 'down' ? 'trend-down' : 'trend-stable';
        const genericDisplay = product.generic || '—';
        
        rows += `
            <tr>
                <td><strong>#${index + 1}</strong></td>
                <td><strong>${escapeHtml(product.brand)}</strong></td>
                <td>${escapeHtml(genericDisplay)}</td>
                <td><strong>${product.currentQuantity}</strong> pcs</td>
                <td>₱${product.currentOriginalRevenue.toFixed(2)}</td>
                <td class="discount-cell">-₱${product.currentDiscountAmount.toFixed(2)}</td>
                <td class="revenue-cell">₱${product.currentRevenue.toFixed(2)}</td>
                <td>${product.velocity}/day</td>
                <td class="${trendClass}">${trendIcon} ${product.growth}%</td>
            </tr>
        `;
    });
    
    container.innerHTML = `
        <div class="fast-moving-header">
            <h3><i class="fas fa-rocket"></i> Fast Moving Products (Top 20)</h3>
            <p class="fast-moving-subtitle">Products ranked by sales volume - Higher quantity = Faster moving</p>
        </div>
        <div class="fast-moving-table-container">
            <table class="fast-moving-table">
                <thead>
                    <tr>
                        <th>Rank</th>
                        <th>Brand Name</th>
                        <th>Generic Name</th>
                        <th>Qty Sold</th>
                        <th>Original Price</th>
                        <th>Discount</th>
                        <th>Total Revenue</th>
                        <th>Daily Velocity</th>
                        <th>vs Last Month</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
}

// PDF Download
const downloadReportPDFBtn = document.getElementById('downloadReportPDFBtn');
if (downloadReportPDFBtn) {
    downloadReportPDFBtn.addEventListener('click', downloadReportPDF);
}

async function downloadReportPDF() {
    try {
        showNotification('Generating comprehensive PDF report...', 'info');
        
        const selectedMonth = parseInt(document.getElementById('reportMonth')?.value || new Date().getMonth());
        const selectedYear = parseInt(document.getElementById('reportYear')?.value || new Date().getFullYear());
        const period = document.getElementById('reportPeriod')?.value || 'daily';
        
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                            'July', 'August', 'September', 'October', 'November', 'December'];
        
        const chartCanvas = document.getElementById('reportChart');
        
        const reportStats = document.getElementById('reportStats');
        const statsCards = reportStats.querySelectorAll('.stat-card');
        let totalSales = 0, transactions = 0, totalDiscount = 0, averageSale = 0;
        
        if (statsCards.length >= 4) {
            totalSales = parseFloat(statsCards[0]?.querySelector('p')?.textContent?.replace('₱', '') || 0);
            transactions = parseInt(statsCards[1]?.querySelector('p')?.textContent || 0);
            totalDiscount = parseFloat(statsCards[2]?.querySelector('p')?.textContent?.replace('₱', '') || 0);
            averageSale = parseFloat(statsCards[3]?.querySelector('p')?.textContent?.replace('₱', '') || 0);
        }
        
        // Use cached data if available
        const productSalesData = reportCache.productSales ? 
            {
                all: reportCache.productSales.all,
                seniorPWD: reportCache.productSales.seniorPWD,
                yakap: reportCache.productSales.yakap
            } : await getProductSalesData(selectedMonth, selectedYear);
        
        const fastMovingData = reportCache.fastMoving || await getFastMovingData(selectedMonth, selectedYear);
        
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4'
        });
        
        let yPos = 15;
        const pageWidth = doc.internal.pageSize.getWidth();
        const margin = 14;
        
        // Add header
        yPos = addPDFHeader(doc, pageWidth, margin, yPos, monthNames[selectedMonth], selectedYear, period);
        
        // Add chart
        yPos = await addPDFChart(doc, chartCanvas, margin, pageWidth, yPos);
        
        // Add fast moving products
        yPos = addPDFFastMoving(doc, margin, pageWidth, yPos, fastMovingData);
        
        // Add product sales breakdowns
        yPos = addPDFProductBreakdown(doc, margin, pageWidth, yPos, productSalesData, 'all', 'Product Sales Breakdown - All Sales', [52, 152, 219]);
        yPos = addPDFProductBreakdown(doc, margin, pageWidth, yPos, productSalesData, 'seniorPWD', 'Senior/PWD Discounted Sales', [102, 126, 234]);
        yPos = addPDFProductBreakdown(doc, margin, pageWidth, yPos, productSalesData, 'yakap', 'YAKAP Discounted Sales', [255, 107, 107]);
        
        doc.save(`comprehensive_report_${monthNames[selectedMonth]}_${selectedYear}.pdf`);
        showNotification('PDF report downloaded successfully!', 'success');
        
    } catch (error) {
        console.error("Error generating report PDF:", error);
        showNotification('Error generating PDF report', 'error');
    }
}

function addPDFHeader(doc, pageWidth, margin, yPos, monthName, year, period) {
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text('GMDC BOTICA PHARMACY', pageWidth / 2, yPos, { align: 'center' });
    yPos += 8;
    
    doc.setFontSize(18);
    doc.setTextColor(52, 152, 219);
    doc.text('Comprehensive Sales Report', pageWidth / 2, yPos, { align: 'center' });
    yPos += 8;
    
    doc.setFontSize(14);
    doc.setTextColor(44, 62, 80);
    doc.text(`${monthName} ${year} - ${period.charAt(0).toUpperCase() + period.slice(1)} Analysis`, pageWidth / 2, yPos, { align: 'center' });
    yPos += 10;
    
    doc.setFontSize(10);
    doc.setTextColor(127, 140, 141);
    const now = new Date();
    doc.text(`Generated on: ${now.toLocaleString()}`, margin, yPos);
    yPos += 5;
    
    const cashierName = document.getElementById('sidebarUserName')?.textContent || 'Unknown';
    doc.text(`Generated by: ${cashierName}`, margin, yPos);
    yPos += 10;
    
    return yPos;
}

async function addPDFChart(doc, chartCanvas, margin, pageWidth, yPos) {
    try {
        const chartImage = chartCanvas.toDataURL('image/png');
        doc.addImage(chartImage, 'PNG', margin, yPos, pageWidth - (margin * 2), 70);
        yPos += 75;
    } catch (error) {
        console.error("Error adding chart to PDF:", error);
    }
    return yPos;
}

function addPDFFastMoving(doc, margin, pageWidth, yPos, fastMovingData) {
    if (fastMovingData.length > 0) {
        if (yPos > 250) {
            doc.addPage();
            yPos = 20;
        }
        
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text('Fast Moving Products - Top 20', margin, yPos);
        yPos += 7;
        
        const fastMovingRows = fastMovingData.slice(0, 20).map((product, index) => {
            const genericDisplay = product.generic || '—';
            return [
                `#${index + 1}`,
                truncate(product.brand, 12),
                truncate(genericDisplay, 10),
                product.currentQuantity.toString(),
                product.currentOriginalRevenue.toFixed(2),
                product.currentDiscountAmount.toFixed(2),
                product.currentRevenue.toFixed(2),
                product.velocity + '/day',
                product.growth + '%'
            ];
        });
        
        doc.autoTable({
            head: [['Rank', 'Brand', 'Generic', 'Qty', 'Original', 'Discount', 'Total', 'Velocity', 'Growth']],
            body: fastMovingRows,
            startY: yPos,
            theme: 'striped',
            headStyles: { fillColor: [255, 159, 64] },
            margin: { left: margin, right: margin }
        });
        
        yPos = doc.lastAutoTable.finalY + 15;
    }
    return yPos;
}

function addPDFProductBreakdown(doc, margin, pageWidth, yPos, productSalesData, type, title, color) {
    const data = productSalesData[type];
    if (data && data.length > 0) {
        if (yPos > 250) {
            doc.addPage();
            yPos = 20;
        }
        
        doc.setFontSize(type === 'all' ? 16 : 14);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(color[0], color[1], color[2]);
        doc.text(title, margin, yPos);
        yPos += 7;
        
        const totalOriginal = data.reduce((sum, p) => sum + p.originalRevenue, 0);
        const totalDiscount = data.reduce((sum, p) => sum + p.discountAmount, 0);
        const totalFinal = data.reduce((sum, p) => sum + p.revenue, 0);
        
        doc.setFontSize(10);
        doc.setTextColor(127, 140, 141);
        doc.text(`Summary: Original: ₱${totalOriginal.toFixed(2)} | Discount: ₱${totalDiscount.toFixed(2)} | Total: ₱${totalFinal.toFixed(2)}`, margin, yPos);
        yPos += 7;
        
        const columns = type === 'all' 
            ? ["Brand", "Generic", "Qty", "Original", "Discount", "Total", "%"]
            : ["Brand", "Generic", "Qty", "Original", "Discount", "Total"];
        
        const rows = data.slice(0, type === 'all' ? 15 : 10).map(product => {
            const genericDisplay = product.generic || '—';
            const row = [
                truncate(product.brand, 15),
                truncate(genericDisplay, 12),
                product.quantity.toString(),
                product.originalRevenue.toFixed(2),
                product.discountAmount.toFixed(2),
                product.revenue.toFixed(2)
            ];
            if (type === 'all') {
                const percentage = totalFinal > 0 ? ((product.revenue / totalFinal) * 100).toFixed(1) : 0;
                row.push(percentage + '%');
            }
            return row;
        });
        
        doc.autoTable({
            head: [columns],
            body: rows,
            startY: yPos,
            theme: 'striped',
            headStyles: { fillColor: color },
            margin: { left: margin, right: margin }
        });
        
        yPos = doc.lastAutoTable.finalY + 15;
    }
    return yPos;
}

function truncate(str, maxLen) {
    return str.length > maxLen ? str.substring(0, maxLen - 3) + '...' : str;
}

async function getProductSalesData(selectedMonth, selectedYear) {
    try {
        const startDate = new Date(selectedYear, selectedMonth, 1);
        startDate.setHours(0, 0, 0, 0);
        
        const endDate = new Date(selectedYear, selectedMonth + 1, 1);
        endDate.setHours(0, 0, 0, 0);
        
        const salesSnapshot = await getDocs(query(
            collection(db, "sales"),
            where("date", ">=", Timestamp.fromDate(startDate)),
            where("date", "<", Timestamp.fromDate(endDate))
        ));
        
        const result = await processProductSalesBreakdown(salesSnapshot);
        return result.productSalesArray;
        
    } catch (error) {
        console.error("Error getting product sales data:", error);
        return { all: [], seniorPWD: [], yakap: [] };
    }
}

async function getFastMovingData(selectedMonth, selectedYear) {
    return processFastMovingProducts(selectedMonth, selectedYear);
}

// Utility Functions
function showNotification(message, type = 'info') {
    let notification = document.querySelector('.notification-toast');
    if (!notification) {
        notification = document.createElement('div');
        notification.className = 'notification-toast';
        document.body.appendChild(notification);
    }
    
    notification.textContent = message;
    notification.className = `notification-toast ${type}`;
    notification.style.display = 'block';
    
    setTimeout(() => {
        notification.style.display = 'none';
    }, 3000);
}

function setupEventListeners() {
    document.querySelectorAll('.close').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.closest('.modal').style.display = 'none';
        });
    });
}

// Make functions global
window.migrateExpiryDatesToBatches = async function() {
    try {
        console.log("Starting migration: Converting product expiry dates to batches...");
        
        const productsSnapshot = await getDocs(collection(db, "products"));
        let migratedCount = 0;
        
        for (const doc of productsSnapshot.docs) {
            const product = doc.data();
            
            if (product.expiryDate && product.stock > 0) {
                const batchData = {
                    productId: doc.id,
                    batchNumber: `MIGRATED-${Date.now()}-${migratedCount}`,
                    quantity: product.stock,
                    expiryDate: product.expiryDate,
                    createdAt: Timestamp.now(),
                    createdBy: loggedInUserId || 'system',
                    notes: 'Migrated from product expiry date'
                };
                
                await addDoc(collection(db, "batches"), batchData);
                migratedCount++;
            }
        }
        
        alert(`Migration complete! Created ${migratedCount} batches.`);
        window.location.reload();
        
    } catch (error) {
        console.error("Error during migration:", error);
        alert("Error during migration: " + error.message);
    }
};