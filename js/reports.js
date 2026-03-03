import { db, collection, getDocs, query, where, orderBy, Timestamp } from './firebase-config.js';
import { fetchUserData } from './auth.js';

// Check if user is logged in
const loggedInUserId = localStorage.getItem('loggedInUserId');
if (!loggedInUserId) {
    window.location.href = 'index.html';
}

let reportChart = null;
let currentDiscountFilter = 'all'; // 'all', 'seniorPWD', 'yakap'

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

async function generateReport() {
    try {
        const reportContent = document.getElementById('reportStats');
        const chartCanvas = document.getElementById('reportChart');
        const breakdownContainer = document.getElementById('productSalesBreakdown');
        const fastMovingContainer = document.getElementById('fastMovingProducts');
        
        if (!reportContent || !chartCanvas || !breakdownContainer || !fastMovingContainer) return;
        
        // Show loading
        breakdownContainer.innerHTML = '<div class="loading">Loading product sales data...</div>';
        fastMovingContainer.innerHTML = '<div class="loading">Analyzing fast moving products...</div>';
        
        const selectedMonth = parseInt(document.getElementById('reportMonth')?.value || new Date().getMonth());
        const selectedYear = parseInt(document.getElementById('reportYear')?.value || new Date().getFullYear());
        const period = document.getElementById('reportPeriod')?.value || 'daily';
        
        let labels = [];
        let data = [];
        let totalSales = 0;
        let totalTransactions = 0;
        
        const startDate = new Date(selectedYear, selectedMonth, 1);
        startDate.setHours(0, 0, 0, 0);
        
        const endDate = new Date(selectedYear, selectedMonth + 1, 1);
        endDate.setHours(0, 0, 0, 0);
        
        const salesQuery = query(
            collection(db, "sales"),
            where("date", ">=", Timestamp.fromDate(startDate)),
            where("date", "<", Timestamp.fromDate(endDate)),
            orderBy("date", "asc")
        );
        
        const salesSnapshot = await getDocs(salesQuery);
        
        const sales = [];
        salesSnapshot.forEach(doc => {
            const sale = doc.data();
            sales.push({ id: doc.id, ...sale });
        });
        
        switch(period) {
            case 'daily':
                const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
                const dailyData = new Array(daysInMonth).fill(0);
                const dailyCount = new Array(daysInMonth).fill(0);
                
                sales.forEach(sale => {
                    const saleDate = sale.date.toDate();
                    const day = saleDate.getDate() - 1;
                    if (day >= 0 && day < daysInMonth) {
                        dailyData[day] += sale.total || 0;
                        dailyCount[day]++;
                    }
                });
                
                labels = [];
                for (let i = 1; i <= daysInMonth; i++) {
                    labels.push(`${i}`);
                }
                data = dailyData;
                totalSales = dailyData.reduce((sum, val) => sum + val, 0);
                totalTransactions = dailyCount.reduce((sum, val) => sum + val, 0);
                break;
                
            case 'weekly':
                const weeksInMonth = 5;
                const weeklyData = new Array(weeksInMonth).fill(0);
                const weeklyCount = new Array(weeksInMonth).fill(0);
                
                sales.forEach(sale => {
                    const saleDate = sale.date.toDate();
                    const dayOfMonth = saleDate.getDate();
                    const weekIndex = Math.floor((dayOfMonth - 1) / 7);
                    if (weekIndex < weeksInMonth) {
                        weeklyData[weekIndex] += sale.total || 0;
                        weeklyCount[weekIndex]++;
                    }
                });
                
                labels = ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5'];
                data = weeklyData;
                totalSales = weeklyData.reduce((sum, val) => sum + val, 0);
                totalTransactions = weeklyCount.reduce((sum, val) => sum + val, 0);
                break;
                
            case 'monthly':
                // For monthly, we'll show the selected month only
                labels = [new Date(selectedYear, selectedMonth, 1).toLocaleDateString('en-US', { month: 'long' })];
                data = [totalSales];
                break;
        }
        
        const averageSale = totalTransactions > 0 ? totalSales / totalTransactions : 0;
        
        displayReport(period, labels, data, totalSales, totalTransactions, averageSale, selectedMonth, selectedYear);
        
        await loadProductSalesBreakdown(selectedMonth, selectedYear);
        await loadFastMovingProducts(selectedMonth, selectedYear);
        
    } catch (error) {
        console.error("Error generating report:", error);
        document.getElementById('reportStats').innerHTML = '<p class="error">Error generating report</p>';
    }
}

function displayReport(period, labels, data, totalSales, totalTransactions, averageSale, selectedMonth, selectedYear) {
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

async function loadProductSalesBreakdown(selectedMonth, selectedYear) {
    try {
        const container = document.getElementById('productSalesBreakdown');
        if (!container) return;
        
        const startDate = new Date(selectedYear, selectedMonth, 1);
        startDate.setHours(0, 0, 0, 0);
        
        const endDate = new Date(selectedYear, selectedMonth + 1, 1);
        endDate.setHours(0, 0, 0, 0);
        
        const salesQuery = query(
            collection(db, "sales"),
            where("date", ">=", Timestamp.fromDate(startDate)),
            where("date", "<", Timestamp.fromDate(endDate))
        );
        
        const salesSnapshot = await getDocs(salesQuery);
        
        // Initialize counters for different discount types
        const productSales = {
            all: {},
            seniorPWD: {},
            yakap: {}
        };
        
        let totals = {
            all: { quantity: 0, revenue: 0 },
            seniorPWD: { quantity: 0, revenue: 0 },
            yakap: { quantity: 0, revenue: 0 }
        };
        
        salesSnapshot.forEach(doc => {
            const sale = doc.data();
            const discountType = sale.discountType || 'none';
            
            if (sale.items && Array.isArray(sale.items)) {
                sale.items.forEach(item => {
                    const brandName = item.brand || item.name || 'Unknown Product';
                    const genericName = item.generic || '';
                    
                    // Create a combined key that includes both brand and generic
                    const displayName = genericName ? `${brandName} (${genericName})` : brandName;
                    const productKey = genericName ? `${brandName}|${genericName}` : brandName;
                    
                    // Always add to 'all'
                    addToProductSales(productSales.all, productKey, brandName, genericName, displayName, item);
                    totals.all.quantity += item.quantity || 0;
                    totals.all.revenue += (item.price * item.quantity) || 0;
                    
                    // Add to specific discount type if applicable
                    if (discountType === 'seniorPWD') {
                        addToProductSales(productSales.seniorPWD, productKey, brandName, genericName, displayName, item);
                        totals.seniorPWD.quantity += item.quantity || 0;
                        totals.seniorPWD.revenue += (item.price * item.quantity) || 0;
                    } else if (discountType === 'yakap') {
                        addToProductSales(productSales.yakap, productKey, brandName, genericName, displayName, item);
                        totals.yakap.quantity += item.quantity || 0;
                        totals.yakap.revenue += (item.price * item.quantity) || 0;
                    }
                });
            }
        });
        
        // Convert objects to arrays and sort
        const productSalesArray = {
            all: Object.entries(productSales.all).map(([key, data]) => ({
                key: key,
                brand: data.brand,
                generic: data.generic,
                displayName: data.displayName,
                quantity: data.quantity,
                revenue: data.revenue
            })).sort((a, b) => b.quantity - a.quantity),
            
            seniorPWD: Object.entries(productSales.seniorPWD).map(([key, data]) => ({
                key: key,
                brand: data.brand,
                generic: data.generic,
                displayName: data.displayName,
                quantity: data.quantity,
                revenue: data.revenue
            })).sort((a, b) => b.quantity - a.quantity),
            
            yakap: Object.entries(productSales.yakap).map(([key, data]) => ({
                key: key,
                brand: data.brand,
                generic: data.generic,
                displayName: data.displayName,
                quantity: data.quantity,
                revenue: data.revenue
            })).sort((a, b) => b.quantity - a.quantity)
        };
        
        displayProductSalesBreakdown(productSalesArray, totals);
        
    } catch (error) {
        console.error("Error loading product sales breakdown:", error);
        document.getElementById('productSalesBreakdown').innerHTML = '<p class="error">Error loading product sales</p>';
    }
}

function addToProductSales(productSalesObj, productKey, brandName, genericName, displayName, item) {
    if (!productSalesObj[productKey]) {
        productSalesObj[productKey] = {
            brand: brandName,
            generic: genericName,
            displayName: displayName,
            quantity: 0,
            revenue: 0
        };
    }
    productSalesObj[productKey].quantity += item.quantity || 0;
    productSalesObj[productKey].revenue += (item.price * item.quantity) || 0;
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
            <p class="no-data">No product sales data for this period with the selected filter</p>
        `;
        
        // Add event listener to dropdown
        document.getElementById('discountFilterSelect')?.addEventListener('change', (e) => {
            currentDiscountFilter = e.target.value;
            displayProductSalesBreakdown(productSalesArray, totals);
        });
        
        return;
    }
    
    let html = `
        <div class="product-sales-header">
            <h3><i class="fas fa-chart-pie"></i> Product Sales Breakdown 
                ${currentDiscountFilter === 'seniorPWD' ? '<span class="filter-badge senior-pwd">Senior/PWD</span>' : 
                  currentDiscountFilter === 'yakap' ? '<span class="filter-badge yakap">YAKAP</span>' : ''}
            </h3>
            <div class="filter-dropdown-container">
                <select id="discountFilterSelect" class="discount-filter-select">
                    <option value="all" ${currentDiscountFilter === 'all' ? 'selected' : ''}>All Sales (₱${totals.all.revenue.toFixed(2)})</option>
                    <option value="seniorPWD" ${currentDiscountFilter === 'seniorPWD' ? 'selected' : ''}>Senior/PWD (₱${totals.seniorPWD.revenue.toFixed(2)})</option>
                    <option value="yakap" ${currentDiscountFilter === 'yakap' ? 'selected' : ''}>YAKAP (₱${totals.yakap.revenue.toFixed(2)})</option>
                </select>
            </div>
        </div>
        <p class="total-summary">Total Items Sold: ${selectedTotals.quantity} pcs | Total Revenue: ₱${selectedTotals.revenue.toFixed(2)}</p>
        <div class="product-sales-table-container">
            <table class="product-sales-table">
                <thead>
                    <tr>
                        <th>Brand Name</th>
                        <th>Generic Name</th>
                        <th>Quantity Sold</th>
                        <th>Revenue (₱)</th>
                        <th>% of Total</th>
                    </tr>
                </thead>
                <tbody>
    `;
    
    selectedData.forEach(product => {
        const percentage = selectedTotals.revenue > 0 ? ((product.revenue / selectedTotals.revenue) * 100).toFixed(1) : 0;
        const genericDisplay = product.generic || '—';
        html += `
            <tr>
                <td><strong>${product.brand}</strong></td>
                <td>${genericDisplay}</td>
                <td><strong>${product.quantity}</strong> pcs</td>
                <td>₱${product.revenue.toFixed(2)}</td>
                <td>${percentage}%</td>
            </tr>
        `;
    });
    
    html += `
                </tbody>
            </table>
        </div>
    `;
    
    container.innerHTML = html;
    
    // Add event listener to dropdown
    document.getElementById('discountFilterSelect')?.addEventListener('change', (e) => {
        currentDiscountFilter = e.target.value;
        displayProductSalesBreakdown(productSalesArray, totals);
    });
}

// New function to load fast moving products (simplified table design)
async function loadFastMovingProducts(selectedMonth, selectedYear) {
    try {
        const container = document.getElementById('fastMovingProducts');
        if (!container) return;
        
        const startDate = new Date(selectedYear, selectedMonth, 1);
        startDate.setHours(0, 0, 0, 0);
        
        const endDate = new Date(selectedYear, selectedMonth + 1, 1);
        endDate.setHours(0, 0, 0, 0);
        
        // Get current month sales
        const currentMonthQuery = query(
            collection(db, "sales"),
            where("date", ">=", Timestamp.fromDate(startDate)),
            where("date", "<", Timestamp.fromDate(endDate))
        );
        
        const currentMonthSnapshot = await getDocs(currentMonthQuery);
        
        // Get previous month sales for comparison
        const prevMonthStart = new Date(selectedYear, selectedMonth - 1, 1);
        prevMonthStart.setHours(0, 0, 0, 0);
        
        const prevMonthEnd = new Date(selectedYear, selectedMonth, 1);
        prevMonthEnd.setHours(0, 0, 0, 0);
        
        const prevMonthQuery = query(
            collection(db, "sales"),
            where("date", ">=", Timestamp.fromDate(prevMonthStart)),
            where("date", "<", Timestamp.fromDate(prevMonthEnd))
        );
        
        const prevMonthSnapshot = await getDocs(prevMonthQuery);
        
        // Analyze product sales
        const productAnalysis = {};
        
        // Process current month sales
        currentMonthSnapshot.forEach(doc => {
            const sale = doc.data();
            if (sale.items && Array.isArray(sale.items)) {
                sale.items.forEach(item => {
                    const brandName = item.brand || item.name || 'Unknown Product';
                    const genericName = item.generic || '';
                    const productKey = genericName ? `${brandName}|${genericName}` : brandName;
                    
                    if (!productAnalysis[productKey]) {
                        productAnalysis[productKey] = {
                            brand: brandName,
                            generic: genericName,
                            currentQuantity: 0,
                            prevQuantity: 0,
                            currentRevenue: 0,
                            prevRevenue: 0
                        };
                    }
                    productAnalysis[productKey].currentQuantity += item.quantity || 0;
                    productAnalysis[productKey].currentRevenue += (item.price * item.quantity) || 0;
                });
            }
        });
        
        // Process previous month sales
        prevMonthSnapshot.forEach(doc => {
            const sale = doc.data();
            if (sale.items && Array.isArray(sale.items)) {
                sale.items.forEach(item => {
                    const brandName = item.brand || item.name || 'Unknown Product';
                    const genericName = item.generic || '';
                    const productKey = genericName ? `${brandName}|${genericName}` : brandName;
                    
                    if (!productAnalysis[productKey]) {
                        productAnalysis[productKey] = {
                            brand: brandName,
                            generic: genericName,
                            currentQuantity: 0,
                            prevQuantity: 0,
                            currentRevenue: 0,
                            prevRevenue: 0
                        };
                    }
                    productAnalysis[productKey].prevQuantity += item.quantity || 0;
                    productAnalysis[productKey].prevRevenue += (item.price * item.quantity) || 0;
                });
            }
        });
        
        // Calculate metrics and convert to array
        const productsArray = Object.values(productAnalysis).map(product => {
            const growth = product.prevQuantity > 0 
                ? ((product.currentQuantity - product.prevQuantity) / product.prevQuantity * 100).toFixed(1)
                : product.currentQuantity > 0 ? '100' : '0';
            
            const velocity = (product.currentQuantity / 30).toFixed(2); // Daily sales velocity
            
            return {
                ...product,
                growth: growth,
                velocity: velocity,
                trend: product.currentQuantity > product.prevQuantity ? 'up' : 
                       product.currentQuantity < product.prevQuantity ? 'down' : 'stable'
            };
        });
        
        // Sort by current quantity (fastest moving first)
        const sortedProducts = productsArray.sort((a, b) => b.currentQuantity - a.currentQuantity);
        
        displayFastMovingProducts(sortedProducts);
        
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
    
    // Get top 20 fastest moving products
    const topProducts = products.slice(0, 20);
    
    let html = `
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
                        <th>Quantity Sold</th>
                        <th>Revenue (₱)</th>
                        <th>Daily Velocity</th>
                        <th>vs Last Month</th>
                    </tr>
                </thead>
                <tbody>
    `;
    
    topProducts.forEach((product, index) => {
        const trendIcon = product.trend === 'up' ? '↑' : product.trend === 'down' ? '↓' : '→';
        const trendClass = product.trend === 'up' ? 'trend-up' : product.trend === 'down' ? 'trend-down' : 'trend-stable';
        const genericDisplay = product.generic || '—';
        
        html += `
            <tr>
                <td><strong>#${index + 1}</strong></td>
                <td><strong>${product.brand}</strong></td>
                <td>${genericDisplay}</td>
                <td><strong>${product.currentQuantity}</strong> pcs</td>
                <td>₱${product.currentRevenue.toFixed(2)}</td>
                <td>${product.velocity} pcs/day</td>
                <td class="${trendClass}">${trendIcon} ${product.growth}%</td>
            </tr>
        `;
    });
    
    html += `
                </tbody>
            </table>
        </div>
    `;
    
    container.innerHTML = html;
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
        let totalSales = 0, transactions = 0, averageSale = 0;
        
        if (statsCards.length >= 3) {
            totalSales = parseFloat(statsCards[0]?.querySelector('p')?.textContent?.replace('₱', '') || 0);
            transactions = parseInt(statsCards[1]?.querySelector('p')?.textContent || 0);
            averageSale = parseFloat(statsCards[2]?.querySelector('p')?.textContent?.replace('₱', '') || 0);
        }
        
        const productSalesData = await getProductSalesData(selectedMonth, selectedYear);
        const fastMovingData = await getFastMovingData(selectedMonth, selectedYear);
        
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4'
        });
        
        let yPos = 15;
        const pageWidth = doc.internal.pageSize.getWidth();
        const margin = 14;
        
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
        doc.text(`${monthNames[selectedMonth]} ${selectedYear} - ${period.charAt(0).toUpperCase() + period.slice(1)} Analysis`, pageWidth / 2, yPos, { align: 'center' });
        yPos += 10;
        
        doc.setFontSize(10);
        doc.setTextColor(127, 140, 141);
        const now = new Date();
        doc.text(`Generated on: ${now.toLocaleString()}`, margin, yPos);
        yPos += 5;
        
        const cashierName = document.getElementById('sidebarUserName')?.textContent || 'Unknown';
        doc.text(`Generated by: ${cashierName}`, margin, yPos);
        yPos += 10;
        
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('Executive Summary', margin, yPos);
        yPos += 7;
        
        doc.setFontSize(11);
        doc.setFont('helvetica', 'normal');
        doc.text(`Gross Sales: ₱${totalSales.toFixed(2)}`, margin + 5, yPos);
        yPos += 6;
        doc.text(`Number of Transactions: ${transactions}`, margin + 5, yPos);
        yPos += 6;
        doc.text(`Average Sale: ₱${averageSale.toFixed(2)}`, margin + 5, yPos);
        yPos += 15;
        
        // Add chart if available
        try {
            const chartImage = chartCanvas.toDataURL('image/png');
            doc.addImage(chartImage, 'PNG', margin, yPos, pageWidth - (margin * 2), 70);
            yPos += 75;
        } catch (error) {
            console.error("Error adding chart to PDF:", error);
        }
        
        // Add Fast Moving Products section
        if (fastMovingData.length > 0) {
            if (yPos > 250) {
                doc.addPage();
                yPos = 20;
            }
            
            doc.setFontSize(16);
            doc.setFont('helvetica', 'bold');
            doc.text('Fast Moving Products - Top 20', margin, yPos);
            yPos += 7;
            
            const fastMovingRows = [];
            fastMovingData.slice(0, 20).forEach((product, index) => {
                const genericDisplay = product.generic || '—';
                fastMovingRows.push([
                    `#${index + 1}`,
                    product.brand.length > 15 ? product.brand.substring(0, 12) + '...' : product.brand,
                    genericDisplay.length > 15 ? genericDisplay.substring(0, 12) + '...' : genericDisplay,
                    product.currentQuantity.toString(),
                    '₱' + product.currentRevenue.toFixed(2),
                    product.velocity + '/day',
                    product.growth + '%'
                ]);
            });
            
            doc.autoTable({
                head: [['Rank', 'Brand', 'Generic', 'Qty', 'Revenue', 'Velocity', 'Growth']],
                body: fastMovingRows,
                startY: yPos,
                theme: 'striped',
                headStyles: { fillColor: [255, 159, 64] },
                margin: { left: margin, right: margin }
            });
            
            yPos = doc.lastAutoTable.finalY + 15;
        }
        
        // Add product sales table for all discount types
        if (productSalesData.all.length > 0) {
            if (yPos > 250) {
                doc.addPage();
                yPos = 20;
            }
            
            doc.setFontSize(16);
            doc.setFont('helvetica', 'bold');
            doc.text('Product Sales Breakdown - All Sales', margin, yPos);
            yPos += 7;
            
            const totalItemsSold = productSalesData.all.reduce((sum, p) => sum + p.quantity, 0);
            const totalRevenue = productSalesData.all.reduce((sum, p) => sum + p.revenue, 0);
            
            doc.setFontSize(10);
            doc.setTextColor(127, 140, 141);
            doc.text(`Total Items Sold: ${totalItemsSold} pcs | Total Revenue: ₱${totalRevenue.toFixed(2)}`, margin, yPos);
            yPos += 7;
            
            const productTableColumn = ["Brand Name", "Generic Name", "Qty", "Revenue (₱)", "%"];
            const productTableRows = [];
            
            productSalesData.all.slice(0, 15).forEach(product => {
                const percentage = totalRevenue > 0 ? ((product.revenue / totalRevenue) * 100).toFixed(1) : 0;
                const genericDisplay = product.generic || '—';
                productTableRows.push([
                    product.brand.length > 20 ? product.brand.substring(0, 17) + '...' : product.brand,
                    genericDisplay.length > 15 ? genericDisplay.substring(0, 12) + '...' : genericDisplay,
                    product.quantity.toString(),
                    product.revenue.toFixed(2),
                    percentage + '%'
                ]);
            });
            
            doc.autoTable({
                head: [productTableColumn],
                body: productTableRows,
                startY: yPos,
                theme: 'striped',
                headStyles: { fillColor: [52, 152, 219] },
                columnStyles: {
                    0: { cellWidth: 40 },
                    1: { cellWidth: 35 },
                    2: { cellWidth: 20, halign: 'center' },
                    3: { cellWidth: 30, halign: 'right' },
                    4: { cellWidth: 20, halign: 'center' }
                },
                margin: { left: margin, right: margin }
            });
            
            yPos = doc.lastAutoTable.finalY + 15;
        }
        
        // Add Senior/PWD breakdown if available
        if (productSalesData.seniorPWD.length > 0) {
            if (yPos > 250) {
                doc.addPage();
                yPos = 20;
            }
            
            doc.setFontSize(14);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(102, 126, 234);
            doc.text('Senior/PWD Discounted Sales', margin, yPos);
            yPos += 7;
            
            const totalRevenue = productSalesData.seniorPWD.reduce((sum, p) => sum + p.revenue, 0);
            
            doc.setFontSize(10);
            doc.setTextColor(127, 140, 141);
            doc.text(`Total Revenue: ₱${totalRevenue.toFixed(2)}`, margin, yPos);
            yPos += 7;
            
            const productTableRows = [];
            
            productSalesData.seniorPWD.slice(0, 10).forEach(product => {
                const genericDisplay = product.generic || '—';
                productTableRows.push([
                    product.brand.length > 20 ? product.brand.substring(0, 17) + '...' : product.brand,
                    genericDisplay.length > 15 ? genericDisplay.substring(0, 12) + '...' : genericDisplay,
                    product.quantity.toString(),
                    product.revenue.toFixed(2)
                ]);
            });
            
            doc.autoTable({
                head: [["Brand Name", "Generic Name", "Qty", "Revenue (₱)"]],
                body: productTableRows,
                startY: yPos,
                theme: 'striped',
                headStyles: { fillColor: [102, 126, 234] },
                margin: { left: margin, right: margin }
            });
            
            yPos = doc.lastAutoTable.finalY + 15;
        }
        
        // Add YAKAP breakdown if available
        if (productSalesData.yakap.length > 0) {
            if (yPos > 250) {
                doc.addPage();
                yPos = 20;
            }
            
            doc.setFontSize(14);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(255, 107, 107);
            doc.text('YAKAP Discounted Sales', margin, yPos);
            yPos += 7;
            
            const totalRevenue = productSalesData.yakap.reduce((sum, p) => sum + p.revenue, 0);
            
            doc.setFontSize(10);
            doc.setTextColor(127, 140, 141);
            doc.text(`Total Revenue: ₱${totalRevenue.toFixed(2)}`, margin, yPos);
            yPos += 7;
            
            const productTableRows = [];
            
            productSalesData.yakap.slice(0, 10).forEach(product => {
                const genericDisplay = product.generic || '—';
                productTableRows.push([
                    product.brand.length > 20 ? product.brand.substring(0, 17) + '...' : product.brand,
                    genericDisplay.length > 15 ? genericDisplay.substring(0, 12) + '...' : genericDisplay,
                    product.quantity.toString(),
                    product.revenue.toFixed(2)
                ]);
            });
            
            doc.autoTable({
                head: [["Brand Name", "Generic Name", "Qty", "Revenue (₱)"]],
                body: productTableRows,
                startY: yPos,
                theme: 'striped',
                headStyles: { fillColor: [255, 107, 107] },
                margin: { left: margin, right: margin }
            });
        }
        
        doc.save(`comprehensive_report_${monthNames[selectedMonth]}_${selectedYear}.pdf`);
        showNotification('PDF report downloaded successfully!', 'success');
        
    } catch (error) {
        console.error("Error generating report PDF:", error);
        showNotification('Error generating PDF report', 'error');
    }
}

async function getProductSalesData(selectedMonth, selectedYear) {
    try {
        const startDate = new Date(selectedYear, selectedMonth, 1);
        startDate.setHours(0, 0, 0, 0);
        
        const endDate = new Date(selectedYear, selectedMonth + 1, 1);
        endDate.setHours(0, 0, 0, 0);
        
        const salesQuery = query(
            collection(db, "sales"),
            where("date", ">=", Timestamp.fromDate(startDate)),
            where("date", "<", Timestamp.fromDate(endDate))
        );
        
        const salesSnapshot = await getDocs(salesQuery);
        
        const productSales = {
            all: {},
            seniorPWD: {},
            yakap: {}
        };
        
        salesSnapshot.forEach(doc => {
            const sale = doc.data();
            const discountType = sale.discountType || 'none';
            
            if (sale.items && Array.isArray(sale.items)) {
                sale.items.forEach(item => {
                    const brandName = item.brand || item.name || 'Unknown Product';
                    const genericName = item.generic || '';
                    
                    // Create a unique key for this product (brand + generic)
                    const productKey = genericName ? `${brandName}|${genericName}` : brandName;
                    
                    // Always add to 'all'
                    addToProductSalesData(productSales.all, productKey, brandName, genericName, item);
                    
                    // Add to specific discount type
                    if (discountType === 'seniorPWD') {
                        addToProductSalesData(productSales.seniorPWD, productKey, brandName, genericName, item);
                    } else if (discountType === 'yakap') {
                        addToProductSalesData(productSales.yakap, productKey, brandName, genericName, item);
                    }
                });
            }
        });
        
        return {
            all: Object.values(productSales.all).sort((a, b) => b.quantity - a.quantity),
            seniorPWD: Object.values(productSales.seniorPWD).sort((a, b) => b.quantity - a.quantity),
            yakap: Object.values(productSales.yakap).sort((a, b) => b.quantity - a.quantity)
        };
        
    } catch (error) {
        console.error("Error getting product sales data:", error);
        return { all: [], seniorPWD: [], yakap: [] };
    }
}

async function getFastMovingData(selectedMonth, selectedYear) {
    try {
        const startDate = new Date(selectedYear, selectedMonth, 1);
        startDate.setHours(0, 0, 0, 0);
        
        const endDate = new Date(selectedYear, selectedMonth + 1, 1);
        endDate.setHours(0, 0, 0, 0);
        
        const prevMonthStart = new Date(selectedYear, selectedMonth - 1, 1);
        prevMonthStart.setHours(0, 0, 0, 0);
        
        const prevMonthEnd = new Date(selectedYear, selectedMonth, 1);
        prevMonthEnd.setHours(0, 0, 0, 0);
        
        const currentMonthQuery = query(
            collection(db, "sales"),
            where("date", ">=", Timestamp.fromDate(startDate)),
            where("date", "<", Timestamp.fromDate(endDate))
        );
        
        const prevMonthQuery = query(
            collection(db, "sales"),
            where("date", ">=", Timestamp.fromDate(prevMonthStart)),
            where("date", "<", Timestamp.fromDate(prevMonthEnd))
        );
        
        const [currentMonthSnapshot, prevMonthSnapshot] = await Promise.all([
            getDocs(currentMonthQuery),
            getDocs(prevMonthQuery)
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
                            currentRevenue: 0,
                            prevQuantity: 0,
                            prevRevenue: 0
                        };
                    }
                    productAnalysis[key].currentQuantity += item.quantity || 0;
                    productAnalysis[key].currentRevenue += (item.price * item.quantity) || 0;
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
                            currentRevenue: 0,
                            prevQuantity: 0,
                            prevRevenue: 0
                        };
                    }
                    productAnalysis[key].prevQuantity += item.quantity || 0;
                    productAnalysis[key].prevRevenue += (item.price * item.quantity) || 0;
                });
            }
        });
        
        // Calculate metrics
        return Object.values(productAnalysis)
            .map(p => {
                const growth = p.prevQuantity 
                    ? ((p.currentQuantity - p.prevQuantity) / p.prevQuantity * 100).toFixed(1)
                    : p.currentQuantity > 0 ? '100' : '0';
                const velocity = (p.currentQuantity / 30).toFixed(2);
                
                return {
                    ...p,
                    growth: growth,
                    velocity: velocity
                };
            })
            .sort((a, b) => b.currentQuantity - a.currentQuantity);
        
    } catch (error) {
        console.error("Error getting fast moving data:", error);
        return [];
    }
}

function addToProductSalesData(obj, key, brand, generic, item) {
    if (!obj[key]) {
        obj[key] = {
            brand: brand,
            generic: generic,
            quantity: 0,
            revenue: 0
        };
    }
    obj[key].quantity += item.quantity || 0;
    obj[key].revenue += (item.price * item.quantity) || 0;
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