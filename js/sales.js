import { db, collection, getDocs, query, where, orderBy, doc, getDoc, Timestamp, addDoc, updateDoc, writeBatch } from './firebase-config.js';
import { fetchUserData } from './auth.js';

// Collection names
const EXCHANGES_COLLECTION = "Exchange_Records";

// Check if user is logged in
const loggedInUserId = localStorage.getItem('loggedInUserId');
if (!loggedInUserId) {
    window.location.href = 'index.html';
}

let currentSortOrder = 'desc';

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initializeSales();
    setupEventListeners();
});

async function initializeSales() {
    await loadUserData();
    updateDateTime();
    loadSalesHistory(currentSortOrder);
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

// ==================== SALES FUNCTIONS ====================

async function loadSalesHistory(sortOrder = 'desc') {
    try {
        const salesQuery = query(
            collection(db, "sales"),
            orderBy("date", sortOrder)
        );
        const salesSnapshot = await getDocs(salesQuery);
        
        const tableBody = document.getElementById('salesTableBody');
        if (!tableBody) return;
        
        tableBody.innerHTML = '';
        
        if (salesSnapshot.empty) {
            tableBody.innerHTML = '<tr><td colspan="7" class="no-data">No sales found</td></tr>';
            return;
        }
        
        salesSnapshot.forEach(doc => {
            const sale = doc.data();
            const withinWindow = isWithinExchangeWindow(sale.date);
            
            let exchangeBadge = '';
            if (sale.exchanges && sale.exchanges.length > 0) {
                exchangeBadge = '<span class="exchange-badge"><i class="fas fa-exchange-alt"></i> Exchanged</span>';
            } else if (withinWindow) {
                exchangeBadge = '<span class="exchange-eligible"><i class="fas fa-clock"></i> Exchange Eligible</span>';
            } else {
                exchangeBadge = '<span class="exchange-expired"><i class="fas fa-lock"></i> Exchange Closed</span>';
            }
            
            // Discount badge based on discount type
            let discountBadge = '';
            if (sale.discountType) {
                if (sale.discountType === 'seniorPWD') {
                    discountBadge = '<span class="discount-badge senior-pwd"><i class="fas fa-id-card"></i> Senior/PWD</span>';
                } else if (sale.discountType === 'yakap') {
                    discountBadge = '<span class="discount-badge yakap"><i class="fas fa-heart"></i> YAKAP</span>';
                }
            }
            
            // Only show expiring badge if the sale actually had expiring items
            const hadExpiring = sale.hadExpiringItems ? 
                '<span class="expiring-sale-badge"><i class="fas fa-clock"></i> Had Expiring</span>' : '';
            
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>
                    <span class="invoice-badge">${sale.invoiceNumber || `#${doc.id.slice(-8)}`}</span> 
                    ${exchangeBadge}
                    ${hadExpiring}
                    ${discountBadge}
                </td>
                <td>${formatDate(sale.date)}</td>
                <td>
                    <div class="items-list">
                        ${sale.items?.map(item => {
                            const displayName = item.brand || item.name || 'Unknown';
                            const genericDisplay = item.generic ? ` (${item.generic})` : '';
                            const expiringBadge = item.wasExpiring ? 
                                '<span class="item-expiring-badge-list" title="This item was expiring soon when sold">⚠️ EXPIRING</span>' : '';
                            return `
                                <div class="item-name">
                                    ${displayName}${genericDisplay} x${item.quantity}
                                    ${expiringBadge}
                                </div>
                            `;
                        }).join('') || 'No items'}
                    </div>
                </td>
                <td>₱${(sale.total || 0).toFixed(2)}</td>
                <td><span class="payment-method">${sale.paymentMethod || 'N/A'}</span></td>
                <td><span class="cashier-name">${sale.cashierName || 'Unknown'}</span></td>
                <td>
                    <button class="btn-icon view-sale" title="View Details" data-id="${doc.id}"><i class="fas fa-eye"></i></button>
                    <button class="btn-icon print-sale" title="Print Receipt" data-id="${doc.id}"><i class="fas fa-print"></i></button>
                    ${withinWindow && !sale.exchanges ? 
                        `<button class="btn-icon exchange-sale" title="Exchange Product" data-id="${doc.id}"><i class="fas fa-exchange-alt"></i></button>` : 
                        `<button class="btn-icon exchange-disabled" disabled title="Exchange not available (24h policy)"><i class="fas fa-lock"></i></button>`}
                </td>
            `;
            tableBody.appendChild(row);
        });
        
        document.querySelectorAll('#salesTableBody tr').forEach(row => {
            const cells = row.querySelectorAll('td');
            const labels = ['Invoice #', 'Date', 'Items', 'Total', 'Payment', 'Cashier', 'Actions'];
            cells.forEach((cell, index) => {
                cell.setAttribute('data-label', labels[index]);
            });
        });
        
        document.querySelectorAll('.view-sale').forEach(btn => {
            btn.addEventListener('click', () => viewSaleDetails(btn.dataset.id));
        });
        
        document.querySelectorAll('.print-sale').forEach(btn => {
            btn.addEventListener('click', () => printReceipt(btn.dataset.id));
        });
        
        document.querySelectorAll('.exchange-sale').forEach(btn => {
            btn.addEventListener('click', () => openExchangeModal(btn.dataset.id));
        });
        
    } catch (error) {
        console.error("Error loading sales history:", error);
    }
}

function isWithinExchangeWindow(saleDate) {
    if (!saleDate) return false;
    
    const saleTimestamp = saleDate.toDate ? saleDate.toDate() : new Date(saleDate);
    const now = new Date();
    const hoursDiff = (now - saleTimestamp) / (60 * 60 * 1000);
    
    return hoursDiff <= 24;
}

function formatDate(timestamp) {
    if (!timestamp) return 'N/A';
    try {
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (error) {
        return 'Invalid Date';
    }
}

// ==================== EXCHANGE MODAL FUNCTIONS ====================

function createEnhancedExchangeModal() {
    if (document.getElementById('enhancedExchangeModal')) {
        return document.getElementById('enhancedExchangeModal');
    }
    
    const modalHTML = `
        <div id="enhancedExchangeModal" class="modal">
            <div class="modal-content mobile-modal exchange-enhanced-modal">
                <div class="modal-header">
                    <h2><i class="fas fa-exchange-alt"></i> Process Exchange</h2>
                    <span class="close" onclick="closeModal('enhancedExchangeModal')">&times;</span>
                </div>
                
                <div class="exchange-progress">
                    <div class="progress-step active" id="progressStep1">
                        <span class="step-number">1</span>
                        <span class="step-label">Select Sale</span>
                    </div>
                    <div class="progress-line"></div>
                    <div class="progress-step" id="progressStep2">
                        <span class="step-number">2</span>
                        <span class="step-label">Select Item</span>
                    </div>
                    <div class="progress-line"></div>
                    <div class="progress-step" id="progressStep3">
                        <span class="step-number">3</span>
                        <span class="step-label">Choose Replacement</span>
                    </div>
                    <div class="progress-line"></div>
                    <div class="progress-step" id="progressStep4">
                        <span class="step-number">4</span>
                        <span class="step-label">Confirm</span>
                    </div>
                </div>
                
                <!-- Step 1: Select Sale -->
                <div class="exchange-step" id="exchangeStep1">
                    <div class="step-header">
                        <h3>Select Sale Transaction</h3>
                        <p class="step-description">Search for a sale by invoice number or product name. Only sales within the last 24 hours are eligible.</p>
                    </div>
                    
                    <div class="info-message">
                        <i class="fas fa-info-circle"></i>
                        <span>24-hour exchange policy applies</span>
                    </div>
                    
                    <div class="form-group">
                        <label><i class="fas fa-search"></i> Search Invoice or Product</label>
                        <input type="text" id="enhancedExchangeSearch" class="form-control" placeholder="Type invoice # or product name..." autocomplete="off">
                        <small class="form-text">Enter at least 2 characters to search</small>
                    </div>
                    
                    <div class="search-results-container">
                        <div class="search-results-header">
                            <span>Search Results</span>
                            <span class="results-count" id="enhancedSearchResultsCount">0</span>
                        </div>
                        <div class="search-results" id="enhancedExchangeSearchResults"></div>
                    </div>
                </div>
                
                <!-- Step 2: Select Original Item -->
                <div class="exchange-step" id="exchangeStep2" style="display: none;">
                    <div class="step-header">
                        <h3>Select Item to Exchange</h3>
                        <p class="step-description">Choose which item from this sale needs to be exchanged</p>
                    </div>
                    
                    <div class="selected-sale-card" id="selectedSaleCard"></div>
                    
                    <div class="original-items-section">
                        <h4>Available Items for Exchange</h4>
                        <div class="original-items-grid" id="originalItemsGrid"></div>
                    </div>
                    
                    <div class="step-actions">
                        <button class="btn-secondary" onclick="goToExchangeStep(1)">
                            <i class="fas fa-arrow-left"></i> Back to Search
                        </button>
                    </div>
                </div>
                
                <!-- Step 3: Choose Replacement -->
                <div class="exchange-step" id="exchangeStep3" style="display: none;">
                    <div class="step-header">
                        <h3>Choose Replacement Product</h3>
                        <p class="step-description">Select a product to exchange with and specify quantity</p>
                    </div>
                    
                    <div class="comparison-container">
                        <div class="original-product-box" id="originalProductBox">
                            <h4>Original Item</h4>
                            <div class="product-details">
                                <p class="product-name" id="originalProductName"></p>
                                <p class="product-price" id="originalProductPrice"></p>
                                <p class="product-qty" id="originalProductQty"></p>
                            </div>
                        </div>
                        
                        <div class="exchange-arrow">
                            <i class="fas fa-exchange-alt"></i>
                        </div>
                        
                        <div class="new-product-box">
                            <h4>Replacement Item</h4>
                            <div class="form-group">
                                <label>Search Product</label>
                                <input type="text" id="productSearchInput" class="form-control" placeholder="Type product name...">
                            </div>
                            
                            <div class="product-search-results" id="productSearchResults"></div>
                            
                            <div class="form-group">
                                <label>Or Select from List</label>
                                <select id="newProductSelectEnhanced" class="form-control">
                                    <option value="">-- Select replacement product --</option>
                                </select>
                            </div>
                            
                            <div class="form-group">
                                <label>Exchange Quantity</label>
                                <input type="number" id="exchangeQuantityEnhanced" class="form-control" min="1" value="1">
                            </div>
                        </div>
                    </div>
                    
                    <div class="price-comparison-card" id="priceComparisonCard" style="display: none;">
                        <h4>Price Comparison</h4>
                        <div class="price-row">
                            <span>Original Total:</span>
                            <span>₱<span id="originalTotalPrice">0.00</span></span>
                        </div>
                        <div class="price-row">
                            <span>New Total:</span>
                            <span>₱<span id="newTotalPrice">0.00</span></span>
                        </div>
                        <div class="price-row difference" id="differenceRow">
                            <span>Difference:</span>
                            <span id="differenceAmount">₱0.00</span>
                        </div>
                        <div class="price-note" id="priceNote"></div>
                    </div>
                    
                    <div class="form-group">
                        <label>Reason for Exchange</label>
                        <select id="exchangeReasonEnhanced" class="form-control">
                            <option value="defective">Defective Product</option>
                            <option value="wrong_size">Wrong Size/Expiry</option>
                            <option value="wrong_item">Wrong Item</option>
                            <option value="customer_preference">Customer Preference</option>
                            <option value="damaged">Damaged Product</option>
                            <option value="other">Other</option>
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label>Additional Notes (Optional)</label>
                        <textarea id="exchangeNotesEnhanced" class="form-control" rows="2" placeholder="Enter any additional notes..."></textarea>
                    </div>
                    
                    <div class="step-actions">
                        <button class="btn-secondary" onclick="goToExchangeStep(2)">
                            <i class="fas fa-arrow-left"></i> Back to Items
                        </button>
                        <button class="btn-primary" id="reviewExchangeBtn">
                            Review Exchange <i class="fas fa-arrow-right"></i>
                        </button>
                    </div>
                </div>
                
                <!-- Step 4: Confirm -->
                <div class="exchange-step" id="exchangeStep4" style="display: none;">
                    <div class="step-header">
                        <h3>Confirm Exchange</h3>
                        <p class="step-description">Please review the exchange details before confirming</p>
                    </div>
                    
                    <div class="confirmation-card">
                        <div class="confirmation-section">
                            <h4><i class="fas fa-file-invoice"></i> Sale Information</h4>
                            <div class="confirmation-details" id="confirmSaleInfo"></div>
                        </div>
                        
                        <div class="confirmation-section">
                            <h4><i class="fas fa-undo-alt"></i> Exchange Details</h4>
                            <div class="confirmation-details" id="confirmExchangeDetails"></div>
                        </div>
                        
                        <div class="confirmation-section">
                            <h4><i class="fas fa-calculator"></i> Price Summary</h4>
                            <div class="confirmation-details" id="confirmPriceSummary"></div>
                        </div>
                        
                        <div class="confirmation-section">
                            <h4><i class="fas fa-comment"></i> Reason</h4>
                            <div class="confirmation-details" id="confirmReason"></div>
                        </div>
                    </div>
                    
                    <div class="step-actions">
                        <button class="btn-secondary" onclick="goToExchangeStep(3)">
                            <i class="fas fa-arrow-left"></i> Back
                        </button>
                        <button class="btn-success" id="processExchangeEnhancedBtn">
                            <i class="fas fa-check-circle"></i> Confirm Exchange
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    addEnhancedExchangeStyles();
    setupEnhancedExchangeListeners();
    
    return document.getElementById('enhancedExchangeModal');
}

function addEnhancedExchangeStyles() {
    if (document.getElementById('enhanced-exchange-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'enhanced-exchange-styles';
    style.textContent = `
        .exchange-enhanced-modal .modal-content {
            max-width: 800px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        
        .exchange-progress {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: white;
            padding: 20px;
            border-radius: 15px;
            margin-bottom: 15px;
        }
        
        .progress-step {
            display: flex;
            flex-direction: column;
            align-items: center;
            flex: 1;
        }
        
        .progress-step .step-number {
            width: 35px;
            height: 35px;
            background: #e0e0e0;
            color: #666;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            margin-bottom: 5px;
        }
        
        .progress-step.active .step-number {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }
        
        .progress-step.completed .step-number {
            background: #4caf50;
            color: white;
        }
        
        .progress-step .step-label {
            font-size: 12px;
            color: #666;
        }
        
        .progress-step.active .step-label {
            color: #667eea;
            font-weight: 600;
        }
        
        .progress-line {
            height: 2px;
            background: #e0e0e0;
            flex: 0.5;
        }
        
        .exchange-step {
            background: white;
            border-radius: 15px;
            padding: 25px;
        }
        
        .step-header h3 {
            margin: 0 0 5px 0;
            color: #333;
        }
        
        .info-message {
            background: #e3f2fd;
            color: #1976d2;
            padding: 12px 15px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 20px;
        }
        
        .search-results-container {
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            margin-top: 15px;
            max-height: 300px;
            overflow-y: auto;
        }
        
        .search-results-header {
            display: flex;
            justify-content: space-between;
            padding: 12px 15px;
            background: #f5f5f5;
            border-bottom: 1px solid #e0e0e0;
            font-weight: 600;
        }
        
        .results-count {
            background: #667eea;
            color: white;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 12px;
        }
        
        .search-result-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px;
            border-bottom: 1px solid #f0f0f0;
            cursor: pointer;
        }
        
        .search-result-item:hover {
            background: #f8f9fa;
        }
        
        .result-badge {
            background: #4caf50;
            color: white;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
        }
        
        .selected-sale-card {
            background: #f8f9fa;
            border-radius: 8px;
            padding: 15px;
            margin-bottom: 20px;
        }
        
        .selected-sale-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 8px;
        }
        
        .original-items-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
            gap: 15px;
            margin-top: 15px;
        }
        
        .original-item-card {
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            padding: 15px;
            cursor: pointer;
        }
        
        .original-item-card:hover {
            border-color: #667eea;
        }
        
        .original-item-card.selected {
            border: 2px solid #667eea;
            background: #f0f7ff;
        }
        
        .available-badge {
            background: #4caf50;
            color: white;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 11px;
        }
        
        .comparison-container {
            display: grid;
            grid-template-columns: 1fr auto 1fr;
            gap: 20px;
            align-items: center;
            margin-bottom: 20px;
        }
        
        .exchange-arrow {
            text-align: center;
            color: #667eea;
            font-size: 30px;
        }
        
        .product-search-results {
            max-height: 200px;
            overflow-y: auto;
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            margin: 10px 0;
            display: none;
        }
        
        .product-search-results.active {
            display: block;
        }
        
        .product-result-item {
            padding: 12px;
            border-bottom: 1px solid #f0f0f0;
            cursor: pointer;
            transition: background 0.2s;
        }
        
        .product-result-item:hover {
            background: #f0f7ff;
        }
        
        .product-result-item.selected {
            background: #e3f2fd;
            border-left: 3px solid #2196F3;
        }
        
        .product-name {
            font-weight: 600;
            color: #2c3e50;
            margin-bottom: 4px;
        }
        
        .product-price {
            font-size: 12px;
            color: #27ae60;
        }
        
        .price-comparison-card {
            background: #f8f9fa;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
        }
        
        .price-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 10px;
        }
        
        .price-row.difference {
            margin-top: 10px;
            padding-top: 10px;
            border-top: 2px dashed #ddd;
            font-weight: 600;
        }
        
        .price-row.difference.positive {
            color: #e74c3c;
        }
        
        .price-row.difference.negative {
            color: #27ae60;
        }
        
        .price-note {
            margin-top: 10px;
            font-size: 13px;
            color: #666;
            font-style: italic;
        }
        
        .confirmation-card {
            background: #f8f9fa;
            border-radius: 12px;
            padding: 20px;
        }
        
        .confirmation-section {
            margin-bottom: 20px;
            padding-bottom: 20px;
            border-bottom: 1px solid #e0e0e0;
        }
        
        .confirmation-section h4 {
            margin: 0 0 15px 0;
            color: #333;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .confirmation-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 8px;
        }
        
        .confirmation-row.total {
            margin-top: 10px;
            padding-top: 10px;
            border-top: 2px solid #ddd;
            font-size: 16px;
            font-weight: bold;
        }
        
        .btn-success {
            background: linear-gradient(135deg, #4caf50 0%, #45a049 100%);
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
        }
        
        @media (max-width: 768px) {
            .comparison-container {
                grid-template-columns: 1fr;
            }
            
            .exchange-arrow {
                transform: rotate(90deg);
            }
            
            .original-items-grid {
                grid-template-columns: 1fr;
            }
        }
    `;
    document.head.appendChild(style);
}

function setupEnhancedExchangeListeners() {
    const searchInput = document.getElementById('enhancedExchangeSearch');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(async (e) => {
            const searchTerm = e.target.value.trim();
            if (searchTerm.length >= 2) {
                await searchSalesEnhanced(searchTerm);
            } else {
                document.getElementById('enhancedExchangeSearchResults').innerHTML = '';
                document.getElementById('enhancedSearchResultsCount').textContent = '0';
            }
        }, 300));
    }
    
    const productSearch = document.getElementById('productSearchInput');
    if (productSearch) {
        productSearch.addEventListener('input', debounce(async (e) => {
            const searchTerm = e.target.value.trim();
            if (searchTerm.length >= 2) {
                await searchProductsEnhanced(searchTerm);
            } else {
                document.getElementById('productSearchResults').innerHTML = '';
                document.getElementById('productSearchResults').classList.remove('active');
            }
        }, 300));
    }
    
    const newProductSelect = document.getElementById('newProductSelectEnhanced');
    if (newProductSelect) {
        newProductSelect.addEventListener('change', calculateEnhancedPriceDifference);
    }
    
    const exchangeQuantity = document.getElementById('exchangeQuantityEnhanced');
    if (exchangeQuantity) {
        exchangeQuantity.addEventListener('input', calculateEnhancedPriceDifference);
    }
    
    const reviewBtn = document.getElementById('reviewExchangeBtn');
    if (reviewBtn) {
        reviewBtn.addEventListener('click', showExchangeReview);
    }
    
    const processBtn = document.getElementById('processExchangeEnhancedBtn');
    if (processBtn) {
        processBtn.addEventListener('click', processEnhancedExchange);
    }
}

async function searchSalesEnhanced(searchTerm) {
    const resultsDiv = document.getElementById('enhancedExchangeSearchResults');
    const resultsCount = document.getElementById('enhancedSearchResultsCount');
    if (!resultsDiv) return;
    
    try {
        resultsDiv.innerHTML = '<div style="text-align: center; padding: 20px;"><i class="fas fa-spinner fa-spin"></i> Searching...</div>';
        
        const salesQuery = query(collection(db, "sales"), orderBy("date", "desc"));
        const salesSnapshot = await getDocs(salesQuery);
        const now = new Date();
        const results = [];
        
        salesSnapshot.forEach(doc => {
            const sale = doc.data();
            const saleDate = sale.date?.toDate?.() || new Date(sale.date);
            const hoursDiff = (now - saleDate) / (60 * 60 * 1000);
            
            if (hoursDiff > 24) return;
            
            // Check if sale has any items left to exchange
            let hasAvailableItems = false;
            if (sale.items) {
                const exchangedQuantities = sale.exchanges?.reduce((acc, ex) => {
                    acc[ex.originalProductId] = (acc[ex.originalProductId] || 0) + ex.quantity;
                    return acc;
                }, {}) || {};
                
                hasAvailableItems = sale.items.some(item => {
                    const exchanged = exchangedQuantities[item.productId] || 0;
                    return (item.quantity - exchanged) > 0;
                });
            }
            
            if (!hasAvailableItems) return;
            
            if (sale.invoiceNumber?.toLowerCase().includes(searchTerm.toLowerCase())) {
                results.push({ id: doc.id, ...sale });
                return;
            }
            
            sale.items?.forEach(item => {
                const brand = (item.brand || '').toLowerCase();
                const name = (item.name || '').toLowerCase();
                if (brand.includes(searchTerm) || name.includes(searchTerm)) {
                    results.push({ id: doc.id, ...sale });
                }
            });
        });
        
        const uniqueResults = Array.from(new Map(results.map(r => [r.id, r])).values());
        resultsCount.textContent = uniqueResults.length;
        
        if (uniqueResults.length === 0) {
            resultsDiv.innerHTML = '<div style="text-align: center; padding: 20px; color: #7f8c8d;">No eligible sales found</div>';
            return;
        }
        
        resultsDiv.innerHTML = '';
        uniqueResults.forEach(sale => {
            const resultDiv = document.createElement('div');
            resultDiv.className = 'search-result-item';
            resultDiv.innerHTML = `
                <div class="result-info">
                    <h4>${sale.invoiceNumber || 'No Invoice'}</h4>
                    <p>${formatDate(sale.date)} • ${sale.items?.length || 0} items • ₱${(sale.total || 0).toFixed(2)}</p>
                </div>
                <span class="result-badge">Select</span>
            `;
            resultDiv.addEventListener('click', () => selectSaleEnhanced(sale.id, sale));
            resultsDiv.appendChild(resultDiv);
        });
        
    } catch (error) {
        console.error("Error searching sales:", error);
        resultsDiv.innerHTML = '<div style="text-align: center; padding: 20px; color: #e74c3c;">Error searching sales</div>';
    }
}

async function selectSaleEnhanced(saleId, saleData) {
    try {
        const modal = document.getElementById('enhancedExchangeModal');
        modal.dataset.saleId = saleId;
        
        updateProgressStep(1, true);
        updateProgressStep(2, true);
        
        const selectedSaleCard = document.getElementById('selectedSaleCard');
        selectedSaleCard.innerHTML = `
            <div class="selected-sale-row">
                <span class="label">Invoice:</span>
                <span class="value">${saleData.invoiceNumber || `#${saleId.slice(-8).toUpperCase()}`}</span>
            </div>
            <div class="selected-sale-row">
                <span class="label">Date:</span>
                <span class="value">${formatDate(saleData.date)}</span>
            </div>
            <div class="selected-sale-row">
                <span class="label">Cashier:</span>
                <span class="value">${saleData.cashierName || 'Unknown'}</span>
            </div>
            <div class="selected-sale-row">
                <span class="label">Total:</span>
                <span class="value">₱${(saleData.total || 0).toFixed(2)}</span>
            </div>
        `;
        
        await loadOriginalItemsEnhanced(saleId, saleData);
        goToExchangeStep(2);
        
    } catch (error) {
        console.error("Error selecting sale:", error);
        showNotification('Error selecting sale: ' + error.message, 'error');
    }
}

async function loadOriginalItemsEnhanced(saleId, saleData) {
    const itemsGrid = document.getElementById('originalItemsGrid');
    if (!itemsGrid) return;
    
    try {
        const exchangesQuery = query(
            collection(db, EXCHANGES_COLLECTION),
            where("originalSaleId", "==", saleId)
        );
        const exchangesSnapshot = await getDocs(exchangesQuery);
        
        const exchangedQuantities = new Map();
        exchangesSnapshot.forEach(doc => {
            const ex = doc.data();
            exchangedQuantities.set(ex.originalProductId, (exchangedQuantities.get(ex.originalProductId) || 0) + ex.quantity);
        });
        
        itemsGrid.innerHTML = '';
        
        if (!saleData.items || saleData.items.length === 0) {
            itemsGrid.innerHTML = '<div class="no-data">No items found in this sale</div>';
            return;
        }
        
        let hasAvailableItems = false;
        
        saleData.items.forEach(item => {
            const productId = item.productId || item.id;
            const exchangedQty = exchangedQuantities.get(productId) || 0;
            const originalQty = item.quantity || 0;
            const availableQty = originalQty - exchangedQty;
            
            if (availableQty <= 0) return;
            
            hasAvailableItems = true;
            
            const productName = item.brand || item.name || 'Unknown Product';
            const genericText = item.generic || '';
            const price = item.price || 0;
            
            const itemCard = document.createElement('div');
            itemCard.className = 'original-item-card';
            itemCard.dataset.productId = productId;
            itemCard.dataset.productName = productName;
            itemCard.dataset.price = price;
            itemCard.dataset.availableQty = availableQty;
            itemCard.dataset.generic = genericText;
            
            itemCard.innerHTML = `
                <h4>${productName}${genericText ? ` (${genericText})` : ''}</h4>
                <div class="item-meta">
                    <span>Price: ₱${price.toFixed(2)}</span>
                    <span class="available-badge">Available: ${availableQty}</span>
                </div>
            `;
            
            itemCard.addEventListener('click', () => selectOriginalItemEnhanced(itemCard));
            itemsGrid.appendChild(itemCard);
        });
        
        if (!hasAvailableItems) {
            itemsGrid.innerHTML = '<div class="no-data">No items available for exchange in this sale</div>';
        }
        
    } catch (error) {
        console.error("Error loading original items:", error);
        itemsGrid.innerHTML = '<div class="error">Error loading items</div>';
    }
}

function selectOriginalItemEnhanced(itemCard) {
    document.querySelectorAll('.original-item-card').forEach(card => {
        card.classList.remove('selected');
    });
    
    itemCard.classList.add('selected');
    
    const modal = document.getElementById('enhancedExchangeModal');
    modal.dataset.originalProductId = itemCard.dataset.productId;
    modal.dataset.originalProductName = itemCard.dataset.productName;
    modal.dataset.originalPrice = itemCard.dataset.price;
    modal.dataset.originalAvailableQty = itemCard.dataset.availableQty;
    modal.dataset.originalGeneric = itemCard.dataset.generic || '';
    
    document.getElementById('originalProductName').innerHTML = 
        `<strong>${itemCard.dataset.productName}</strong> ${itemCard.dataset.generic ? `(${itemCard.dataset.generic})` : ''}`;
    document.getElementById('originalProductPrice').innerHTML = `Price per unit: ₱${parseFloat(itemCard.dataset.price).toFixed(2)}`;
    document.getElementById('originalProductQty').innerHTML = `Available quantity: ${itemCard.dataset.availableQty}`;
    
    loadReplacementProductsEnhanced();
    
    updateProgressStep(2, true);
    updateProgressStep(3, true);
    
    goToExchangeStep(3);
}

async function loadReplacementProductsEnhanced() {
    try {
        const select = document.getElementById('newProductSelectEnhanced');
        if (!select) return;
        
        const productsSnapshot = await getDocs(collection(db, "products"));
        
        select.innerHTML = '<option value="">-- Select replacement product --</option>';
        
        const sortedProducts = [];
        productsSnapshot.forEach(doc => {
            const product = { id: doc.id, ...doc.data() };
            if (product.stock > 0) {
                sortedProducts.push(product);
            }
        });
        
        // Sort alphabetically by brand name
        sortedProducts.sort((a, b) => (a.brand || '').localeCompare(b.brand || ''));
        
        sortedProducts.forEach(product => {
            const option = document.createElement('option');
            option.value = product.id;
            option.dataset.price = product.price || 0;
            option.dataset.brand = product.brand || product.name || 'Unnamed';
            option.dataset.generic = product.generic || '';
            option.dataset.stock = product.stock || 0;
            
            const displayName = product.generic ? 
                `${product.brand || product.name} (${product.generic})` : 
                (product.brand || product.name);
            
            option.textContent = `${displayName} - ₱${(product.price || 0).toFixed(2)} (Stock: ${product.stock})`;
            select.appendChild(option);
        });
        
        document.getElementById('exchangeQuantityEnhanced').value = 1;
        document.getElementById('exchangeQuantityEnhanced').max = document.getElementById('enhancedExchangeModal').dataset.originalAvailableQty || 1;
        document.getElementById('priceComparisonCard').style.display = 'none';
        
    } catch (error) {
        console.error("Error loading replacement products:", error);
    }
}

async function searchProductsEnhanced(searchTerm) {
    const resultsDiv = document.getElementById('productSearchResults');
    if (!resultsDiv) return;
    
    try {
        const productsSnapshot = await getDocs(collection(db, "products"));
        const filtered = [];
        
        productsSnapshot.forEach(doc => {
            const product = doc.data();
            if (product.stock > 0) {
                const brand = (product.brand || '').toLowerCase();
                const name = (product.name || '').toLowerCase();
                const generic = (product.generic || '').toLowerCase();
                
                if (brand.includes(searchTerm.toLowerCase()) || 
                    name.includes(searchTerm.toLowerCase()) ||
                    generic.includes(searchTerm.toLowerCase())) {
                    filtered.push({ id: doc.id, ...product });
                }
            }
        });
        
        if (filtered.length === 0) {
            resultsDiv.innerHTML = '<div class="no-results" style="text-align: center; padding: 20px; color: #7f8c8d;">No products found</div>';
            resultsDiv.classList.add('active');
            return;
        }
        
        resultsDiv.innerHTML = '';
        filtered.slice(0, 10).forEach(product => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'product-result-item';
            itemDiv.dataset.productId = product.id;
            itemDiv.dataset.price = product.price;
            itemDiv.dataset.brand = product.brand || product.name;
            itemDiv.dataset.generic = product.generic || '';
            itemDiv.dataset.stock = product.stock;
            
            const displayName = product.generic ? 
                `${product.brand || product.name} (${product.generic})` : 
                (product.brand || product.name);
            
            itemDiv.innerHTML = `
                <div class="product-name">${displayName}</div>
                <div class="product-price">₱${(product.price || 0).toFixed(2)} • Stock: ${product.stock}</div>
            `;
            
            itemDiv.addEventListener('click', () => {
                // Find and select the option in the dropdown
                const select = document.getElementById('newProductSelectEnhanced');
                const options = Array.from(select.options);
                const matchingOption = options.find(opt => opt.value === product.id);
                
                if (matchingOption) {
                    select.value = product.id;
                } else {
                    // If not in dropdown, create temporary option
                    const option = document.createElement('option');
                    option.value = product.id;
                    option.dataset.price = product.price || 0;
                    option.dataset.brand = product.brand || product.name || 'Unnamed';
                    option.dataset.generic = product.generic || '';
                    option.dataset.stock = product.stock || 0;
                    
                    const displayName = product.generic ? 
                        `${product.brand || product.name} (${product.generic})` : 
                        (product.brand || product.name);
                    
                    option.textContent = `${displayName} - ₱${(product.price || 0).toFixed(2)} (Stock: ${product.stock})`;
                    select.appendChild(option);
                    select.value = product.id;
                }
                
                document.getElementById('productSearchInput').value = displayName;
                resultsDiv.classList.remove('active');
                resultsDiv.innerHTML = '';
                calculateEnhancedPriceDifference();
                
                // Remove selected class from all items
                document.querySelectorAll('.product-result-item').forEach(item => {
                    item.classList.remove('selected');
                });
                itemDiv.classList.add('selected');
            });
            
            resultsDiv.appendChild(itemDiv);
        });
        
        resultsDiv.classList.add('active');
        
    } catch (error) {
        console.error("Error searching products:", error);
    }
}

function calculateEnhancedPriceDifference() {
    const modal = document.getElementById('enhancedExchangeModal');
    const newProductSelect = document.getElementById('newProductSelectEnhanced');
    const exchangeQuantity = document.getElementById('exchangeQuantityEnhanced');
    const priceComparison = document.getElementById('priceComparisonCard');
    
    if (!newProductSelect.value || !exchangeQuantity.value) {
        priceComparison.style.display = 'none';
        return;
    }
    
    const originalPrice = parseFloat(modal.dataset.originalPrice);
    const originalAvailableQty = parseInt(modal.dataset.originalAvailableQty);
    const exchangeQty = parseInt(exchangeQuantity.value);
    
    if (exchangeQty > originalAvailableQty) {
        showNotification(`Maximum available quantity is ${originalAvailableQty}`, 'error');
        exchangeQuantity.value = originalAvailableQty;
        return;
    }
    
    const selectedOption = newProductSelect.options[newProductSelect.selectedIndex];
    const newPrice = parseFloat(selectedOption.dataset.price);
    const newStock = parseInt(selectedOption.dataset.stock);
    
    if (exchangeQty > newStock) {
        showNotification(`Only ${newStock} items available in stock`, 'error');
        exchangeQuantity.value = newStock;
        return;
    }
    
    const originalTotal = originalPrice * exchangeQty;
    const newTotal = newPrice * exchangeQty;
    const difference = newTotal - originalTotal;
    
    document.getElementById('originalTotalPrice').textContent = originalTotal.toFixed(2);
    document.getElementById('newTotalPrice').textContent = newTotal.toFixed(2);
    
    const differenceAmount = document.getElementById('differenceAmount');
    const differenceRow = document.getElementById('differenceRow');
    const priceNote = document.getElementById('priceNote');
    
    if (difference > 0) {
        differenceAmount.innerHTML = `+₱${difference.toFixed(2)}`;
        differenceRow.className = 'price-row difference positive';
        priceNote.innerHTML = 'Customer needs to pay the difference';
    } else if (difference < 0) {
        differenceAmount.innerHTML = `-₱${Math.abs(difference).toFixed(2)}`;
        differenceRow.className = 'price-row difference negative';
        priceNote.innerHTML = 'Store refunds the difference to customer';
    } else {
        differenceAmount.innerHTML = `₱0.00`;
        differenceRow.className = 'price-row difference';
        priceNote.innerHTML = 'Even exchange - no payment required';
    }
    
    priceComparison.style.display = 'block';
    
    modal.dataset.originalTotal = originalTotal;
    modal.dataset.newTotal = newTotal;
    modal.dataset.difference = difference;
}

function showExchangeReview() {
    const modal = document.getElementById('enhancedExchangeModal');
    const newProductSelect = document.getElementById('newProductSelectEnhanced');
    const exchangeQuantity = document.getElementById('exchangeQuantityEnhanced');
    const exchangeReason = document.getElementById('exchangeReasonEnhanced');
    
    if (!newProductSelect.value) {
        showNotification('Please select a replacement product', 'error');
        return;
    }
    
    if (!exchangeQuantity.value || parseInt(exchangeQuantity.value) < 1) {
        showNotification('Please enter a valid quantity', 'error');
        return;
    }
    
    const selectedOption = newProductSelect.options[newProductSelect.selectedIndex];
    const saleInvoice = document.querySelector('#selectedSaleCard .value')?.textContent || 'N/A';
    
    modal.dataset.newProductId = newProductSelect.value;
    modal.dataset.newProductName = selectedOption.dataset.brand;
    modal.dataset.newPrice = selectedOption.dataset.price;
    modal.dataset.newGeneric = selectedOption.dataset.generic || '';
    modal.dataset.exchangeReason = exchangeReason.value;
    modal.dataset.exchangeNotes = document.getElementById('exchangeNotesEnhanced').value;
    
    document.getElementById('confirmSaleInfo').innerHTML = `
        <div class="confirmation-row">
            <span class="label">Invoice Number:</span>
            <span class="value">${saleInvoice}</span>
        </div>
    `;
    
    document.getElementById('confirmExchangeDetails').innerHTML = `
        <div class="confirmation-row">
            <span class="label">Original Product:</span>
            <span class="value">${modal.dataset.originalProductName} ${modal.dataset.originalGeneric ? `(${modal.dataset.originalGeneric})` : ''}</span>
        </div>
        <div class="confirmation-row">
            <span class="label">Replacement Product:</span>
            <span class="value">${selectedOption.dataset.brand} ${selectedOption.dataset.generic ? `(${selectedOption.dataset.generic})` : ''}</span>
        </div>
        <div class="confirmation-row">
            <span class="label">Quantity:</span>
            <span class="value">${exchangeQuantity.value}</span>
        </div>
    `;
    
    const difference = parseFloat(modal.dataset.difference);
    document.getElementById('confirmPriceSummary').innerHTML = `
        <div class="confirmation-row">
            <span class="label">Original Total:</span>
            <span class="value">₱${parseFloat(modal.dataset.originalTotal || 0).toFixed(2)}</span>
        </div>
        <div class="confirmation-row">
            <span class="label">New Total:</span>
            <span class="value">₱${parseFloat(modal.dataset.newTotal || 0).toFixed(2)}</span>
        </div>
        <div class="confirmation-row total">
            <span class="label">Difference:</span>
            <span class="value ${difference > 0 ? 'positive' : (difference < 0 ? 'negative' : '')}">
                ${difference > 0 ? '+' : ''}₱${Math.abs(difference).toFixed(2)}
            </span>
        </div>
    `;
    
    document.getElementById('confirmReason').innerHTML = `
        <div class="confirmation-row">
            <span class="label">Reason:</span>
            <span class="value">${exchangeReason.options[exchangeReason.selectedIndex].text}</span>
        </div>
        ${modal.dataset.exchangeNotes ? `
        <div class="confirmation-row">
            <span class="label">Notes:</span>
            <span class="value">${modal.dataset.exchangeNotes}</span>
        </div>
        ` : ''}
    `;
    
    updateProgressStep(3, true);
    updateProgressStep(4, true);
    
    goToExchangeStep(4);
}

// ==================== FIXED EXCHANGE FUNCTION WITH PROPER STOCK RETURN ====================
async function processEnhancedExchange() {
    const modal = document.getElementById('enhancedExchangeModal');
    const processBtn = document.getElementById('processExchangeEnhancedBtn');
    
    if (!processBtn) return;
    
    // Disable button to prevent double submission
    processBtn.disabled = true;
    processBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
    
    try {
        const saleId = modal.dataset.saleId;
        const originalProductId = modal.dataset.originalProductId;
        const originalProductName = modal.dataset.originalProductName;
        const originalPrice = parseFloat(modal.dataset.originalPrice);
        const originalGeneric = modal.dataset.originalGeneric || '';
        const newProductId = modal.dataset.newProductId;
        const newProductName = modal.dataset.newProductName;
        const newPrice = parseFloat(modal.dataset.newPrice);
        const newGeneric = modal.dataset.newGeneric || '';
        const quantity = parseInt(document.getElementById('exchangeQuantityEnhanced').value);
        const originalTotal = parseFloat(modal.dataset.originalTotal);
        const newTotal = parseFloat(modal.dataset.newTotal);
        const priceDifference = parseFloat(modal.dataset.difference);
        const reason = modal.dataset.exchangeReason;
        const notes = modal.dataset.exchangeNotes || '';
        
        // Get the sale document
        const saleRef = doc(db, "sales", saleId);
        const saleDoc = await getDoc(saleRef);
        
        if (!saleDoc.exists()) {
            showNotification('Sale not found', 'error');
            return;
        }
        
        const sale = saleDoc.data();
        
        // Verify exchange window
        if (!isWithinExchangeWindow(sale.date)) {
            showNotification('This transaction is outside the 24-hour exchange window', 'error');
            return;
        }
        
        // Check if item still available for exchange
        const exchangesQuery = query(
            collection(db, EXCHANGES_COLLECTION),
            where("originalSaleId", "==", saleId),
            where("originalProductId", "==", originalProductId)
        );
        const exchangesSnapshot = await getDocs(exchangesQuery);
        
        let totalExchanged = 0;
        exchangesSnapshot.forEach(doc => {
            totalExchanged += doc.data().quantity || 0;
        });
        
        const originalItem = sale.items.find(item => 
            item.productId === originalProductId || item.id === originalProductId
        );
        
        if (!originalItem) {
            showNotification('Original item not found in sale', 'error');
            return;
        }
        
        const availableQty = (originalItem.quantity || 0) - totalExchanged;
        
        if (quantity > availableQty) {
            showNotification(`Only ${availableQty} items available for exchange`, 'error');
            return;
        }
        
        // Check new product stock
        const newProductRef = doc(db, "products", newProductId);
        const newProductDoc = await getDoc(newProductRef);
        
        if (!newProductDoc.exists()) {
            showNotification('Replacement product not found', 'error');
            return;
        }
        
        const newProduct = newProductDoc.data();
        if ((newProduct.stock || 0) < quantity) {
            showNotification(`Insufficient stock for replacement product. Only ${newProduct.stock} available.`, 'error');
            return;
        }
        
        // Use batch for all database operations
        const batch = writeBatch(db);
        
        // ===== STEP 1: Return original items to stock =====
        // Find and update the specific stock items that were sold
        const stockItemsQuery = query(
            collection(db, "stock_items"),
            where("productId", "==", originalProductId),
            where("status", "==", "sold")
        );
        const stockItemsSnapshot = await getDocs(stockItemsQuery);
        
        let returnedCount = 0;
        for (const stockDoc of stockItemsSnapshot.docs) {
            if (returnedCount >= quantity) break;
            
            const stockItem = stockDoc.data();
            // Check if this stock item was part of this sale by checking sold date proximity
            // You might want to add a saleId reference to stock_items for more accuracy
            if (stockItem.soldDate) {
                const soldDate = stockItem.soldDate.toDate();
                const saleDate = sale.date.toDate();
                const timeDiff = Math.abs(soldDate - saleDate);
                
                // If sold within 1 hour of the sale, consider it part of this sale
                if (timeDiff < 60 * 60 * 1000) {
                    batch.update(stockDoc.ref, {
                        status: 'available',
                        soldDate: null,
                        soldBy: null,
                        returnedAt: Timestamp.now(),
                        returnedBy: loggedInUserId,
                        exchangeId: `EXC-${Date.now()}-${returnedCount}`
                    });
                    returnedCount++;
                }
            }
        }
        
        // If we couldn't find specific stock items, update the product stock count directly
        if (returnedCount < quantity) {
            console.log(`Only found ${returnedCount} specific stock items to return, adjusting product stock for the rest`);
        }
        
        // Update original product stock count
        const originalProductRef = doc(db, "products", originalProductId);
        const originalProductDoc = await getDoc(originalProductRef);
        
        if (originalProductDoc.exists()) {
            const currentStock = originalProductDoc.data().stock || 0;
            batch.update(originalProductRef, { 
                stock: currentStock + quantity,
                lastUpdated: Timestamp.now() 
            });
        }
        
        // ===== STEP 2: Deduct new items from stock =====
        // Find available stock items for the new product
        const newStockItemsQuery = query(
            collection(db, "stock_items"),
            where("productId", "==", newProductId),
            where("status", "==", "available")
        );
        const newStockItemsSnapshot = await getDocs(newStockItemsQuery);
        
        let deductedCount = 0;
        for (const stockDoc of newStockItemsSnapshot.docs) {
            if (deductedCount >= quantity) break;
            
            batch.update(stockDoc.ref, {
                status: 'sold',
                soldDate: Timestamp.now(),
                soldBy: loggedInUserId,
                exchangeFor: originalProductId,
                exchangeDate: Timestamp.now()
            });
            deductedCount++;
        }
        
        // Update new product stock count
        batch.update(newProductRef, {
            stock: (newProduct.stock || 0) - quantity,
            lastUpdated: Timestamp.now()
        });
        
        // ===== STEP 3: Create exchange record =====
        const exchangeId = await generateExchangeId();
        const cashierName = document.getElementById('sidebarUserName')?.textContent || 'Unknown';
        
        const exchangeData = {
            exchangeId: exchangeId,
            originalSaleId: saleId,
            originalInvoiceNumber: sale.invoiceNumber,
            originalProductId: originalProductId,
            originalProduct: originalProductName,
            originalPrice: originalPrice,
            originalGeneric: originalGeneric,
            newProductId: newProductId,
            newProduct: newProductName,
            newPrice: newPrice,
            newGeneric: newGeneric,
            quantity: quantity,
            originalTotal: originalTotal,
            newTotal: newTotal,
            priceDifference: priceDifference,
            reason: reason,
            notes: notes,
            date: Timestamp.now(),
            cashierId: loggedInUserId,
            cashierName: cashierName,
            status: 'completed',
            returnedStockItems: returnedCount,
            deductedStockItems: deductedCount
        };
        
        const exchangeRef = doc(collection(db, EXCHANGES_COLLECTION));
        batch.set(exchangeRef, exchangeData);
        
        // ===== STEP 4: Update sale record =====
        const updatedItems = sale.items.map(item => {
            if (item.productId === originalProductId || item.id === originalProductId) {
                return {
                    ...item,
                    exchangedQuantity: (item.exchangedQuantity || 0) + quantity
                };
            }
            return item;
        });
        
        const saleExchanges = sale.exchanges || [];
        saleExchanges.push({
            exchangeId: exchangeId,
            originalProductId: originalProductId,
            originalProduct: originalProductName,
            newProductId: newProductId,
            newProduct: newProductName,
            quantity: quantity,
            priceDifference: priceDifference,
            date: Timestamp.now(),
            reason: reason
        });
        
        batch.update(saleRef, { 
            items: updatedItems,
            exchanges: saleExchanges, 
            lastUpdated: Timestamp.now() 
        });
        
        // ===== STEP 5: Log activity =====
        const activityRef = doc(collection(db, "activities"));
        batch.set(activityRef, {
            type: 'exchange',
            description: `Exchange #${exchangeId}: ${quantity} x ${originalProductName} → ${newProductName}`,
            timestamp: Timestamp.now(),
            userId: loggedInUserId
        });
        
        // Commit all changes
        await batch.commit();
        
        showNotification(`Exchange processed successfully! ${returnedCount} items returned to stock.`, 'success');
        
        // Close modal and refresh
        closeModal('enhancedExchangeModal');
        loadSalesHistory(currentSortOrder);
        resetExchangeSteps();
        
        // Also refresh inventory if the function exists
        if (typeof window.loadInventory === 'function') {
            window.loadInventory();
        }
        
    } catch (error) {
        console.error("Error processing exchange:", error);
        showNotification('Error processing exchange: ' + error.message, 'error');
    } finally {
        // Re-enable button
        processBtn.disabled = false;
        processBtn.innerHTML = '<i class="fas fa-check-circle"></i> Confirm Exchange';
    }
}

async function updateProductStocks(originalProductId, newProductId, quantity) {
    // This function is now handled in the main exchange function
    // Keeping for backward compatibility
}

async function updateSaleRecord(saleId, exchangeData) {
    // This function is now handled in the main exchange function
    // Keeping for backward compatibility
}

async function generateExchangeId() {
    try {
        const today = new Date();
        const year = today.getFullYear().toString().slice(-2);
        const month = (today.getMonth() + 1).toString().padStart(2, '0');
        const day = today.getDate().toString().padStart(2, '0');
        
        const startOfDay = new Date(today);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(today);
        endOfDay.setHours(23, 59, 59, 999);
        
        const exchangesQuery = query(
            collection(db, EXCHANGES_COLLECTION),
            where("date", ">=", Timestamp.fromDate(startOfDay)),
            where("date", "<=", Timestamp.fromDate(endOfDay))
        );
        
        const exchangesSnapshot = await getDocs(exchangesQuery);
        const count = exchangesSnapshot.size + 1;
        
        return `EXC-${year}${month}${day}-${count.toString().padStart(4, '0')}`;
    } catch (error) {
        return `EXC-${Date.now()}`;
    }
}

function updateProgressStep(step, completed) {
    const progressStep = document.getElementById(`progressStep${step}`);
    if (progressStep && completed) {
        progressStep.classList.add('completed');
    }
}

function resetExchangeSteps() {
    for (let i = 1; i <= 4; i++) {
        const step = document.getElementById(`progressStep${i}`);
        if (step) {
            step.classList.remove('completed', 'active');
        }
    }
    document.getElementById('progressStep1')?.classList.add('active');
}

function goToExchangeStep(step) {
    for (let i = 1; i <= 4; i++) {
        const stepElement = document.getElementById(`exchangeStep${i}`);
        const progressElement = document.getElementById(`progressStep${i}`);
        if (stepElement) stepElement.style.display = 'none';
        if (progressElement) progressElement.classList.remove('active');
    }
    
    const selectedStep = document.getElementById(`exchangeStep${step}`);
    const selectedProgress = document.getElementById(`progressStep${step}`);
    if (selectedStep) selectedStep.style.display = 'block';
    if (selectedProgress) selectedProgress.classList.add('active');
    
    for (let i = 1; i < step; i++) {
        updateProgressStep(i, true);
    }
}

window.openExchangeModal = async function(saleId) {
    try {
        const modal = createEnhancedExchangeModal();
        
        if (saleId) {
            const saleRef = doc(db, "sales", saleId);
            const saleDoc = await getDoc(saleRef);
            
            if (!saleDoc.exists()) {
                showNotification('Sale not found', 'error');
                return;
            }
            
            const sale = saleDoc.data();
            
            if (!isWithinExchangeWindow(sale.date)) {
                showNotification('This transaction is outside the 24-hour exchange window', 'error');
                return;
            }
            
            if (!sale.items || sale.items.length === 0) {
                showNotification('This sale has no items to exchange', 'error');
                return;
            }
            
            await selectSaleEnhanced(saleId, sale);
        } else {
            resetExchangeSteps();
            goToExchangeStep(1);
            document.getElementById('enhancedExchangeSearch').value = '';
            document.getElementById('enhancedExchangeSearchResults').innerHTML = '';
            document.getElementById('enhancedSearchResultsCount').textContent = '0';
        }
        
        modal.style.display = 'block';
        
    } catch (error) {
        console.error("Error opening exchange modal:", error);
        showNotification('Error opening exchange: ' + error.message, 'error');
    }
};

// ==================== VIEW SALE DETAILS ====================

async function viewSaleDetails(saleId) {
    try {
        const modal = document.getElementById('saleDetailsModal');
        const panelBody = document.getElementById('salePanelBody');
        
        if (!modal || !panelBody) return;
        
        panelBody.innerHTML = '<div class="modal-loading"><i class="fas fa-spinner fa-spin"></i><p>Loading sale details...</p></div>';
        modal.style.display = 'block';
        
        const saleRef = doc(db, "sales", saleId);
        const saleDoc = await getDoc(saleRef);
        
        if (!saleDoc.exists()) {
            panelBody.innerHTML = '<div class="modal-error">Sale not found</div>';
            return;
        }
        
        const sale = saleDoc.data();
        const saleDate = sale.date?.toDate?.() || new Date();
        const formattedDate = saleDate.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric',
            hour: '2-digit', 
            minute: '2-digit'
        });
        
        // Add discount type display - FIXED: Update YAKAP to 30%
        let discountInfo = '';
        if (sale.discountType) {
            if (sale.discountType === 'seniorPWD') {
                discountInfo = '<p class="discount-info senior-pwd"><i class="fas fa-id-card"></i> Senior/PWD Discount (20%)</p>';
            } else if (sale.discountType === 'yakap') {
                discountInfo = '<p class="discount-info yakap"><i class="fas fa-heart"></i> YAKAP Discount (30%)</p>';
            }
        }
        
        let itemsHtml = '';
        if (sale.items) {
            sale.items.forEach(item => {
                const displayName = item.brand || item.name || 'Unknown';
                const genericDisplay = item.generic ? `<span class="item-generic">${item.generic}</span>` : '';
                const exchangedDisplay = item.exchangedQuantity ? 
                    `<span class="exchanged-badge">Exchanged: ${item.exchangedQuantity}</span>` : '';
                
                // Show expiring badge at item level
                const expiringBadge = item.wasExpiring ? 
                    '<span class="item-expiring-badge-detail"><i class="fas fa-clock"></i> Expiring</span>' : '';
                
                itemsHtml += `
                    <div class="item-row ${item.wasExpiring ? 'expiring-item-row' : ''}">
                        <div class="item-info">
                            <div class="item-name">${displayName} ${genericDisplay} ${exchangedDisplay} ${expiringBadge}</div>
                            <div class="item-meta">Qty: ${item.quantity}</div>
                        </div>
                        <div class="item-price">₱${(item.price * item.quantity).toFixed(2)}</div>
                    </div>
                `;
            });
        }
        
        let exchangesHtml = '';
        if (sale.exchanges && sale.exchanges.length > 0) {
            exchangesHtml = `<div class="exchange-card"><h3>Exchange History</h3>`;
            sale.exchanges.forEach(ex => {
                exchangesHtml += `
                    <div class="exchange-item">
                        <p><strong>${ex.originalProduct} → ${ex.newProduct}</strong> x${ex.quantity}</p>
                        <p>Difference: ₱${ex.priceDifference.toFixed(2)}</p>
                        <small>${formatDate(ex.date)}</small>
                    </div>
                `;
            });
            exchangesHtml += `</div>`;
        }
        
        panelBody.innerHTML = `
            <div class="invoice-card">
                <h3>${sale.invoiceNumber || 'N/A'}</h3>
                <p>Date: ${formattedDate}</p>
                <p>Cashier: ${sale.cashierName || 'Unknown'}</p>
                ${discountInfo}
            </div>
            <div class="items-card">
                <h4>Items</h4>
                ${itemsHtml}
            </div>
            <div class="summary-card">
                <p>Subtotal: ₱${sale.subtotal?.toFixed(2) || '0.00'}</p>
                ${sale.discountPercentage > 0 ? `<p>Discount: -₱${sale.discountAmount?.toFixed(2) || '0.00'}</p>` : ''}
                <h4>Total: ₱${sale.total?.toFixed(2) || '0.00'}</h4>
            </div>
            ${exchangesHtml}
            <button class="btn-primary" onclick="closeModal('saleDetailsModal')">Close</button>
        `;
        
    } catch (error) {
        console.error("Error viewing sale details:", error);
    }
}

window.printReceipt = function(saleId) {
    alert('Print feature coming soon!');
};

// ==================== FILTER BY DATE ====================

const salesDateFilter = document.getElementById('salesDateFilter');
if (salesDateFilter) {
    salesDateFilter.addEventListener('change', async (e) => {
        const selectedDate = e.target.value;
        if (!selectedDate) {
            loadSalesHistory(currentSortOrder);
            return;
        }
        
        try {
            const startDate = new Date(selectedDate);
            startDate.setHours(0, 0, 0, 0);
            const endDate = new Date(selectedDate);
            endDate.setHours(23, 59, 59, 999);
            
            const salesQuery = query(
                collection(db, "sales"),
                where("date", ">=", Timestamp.fromDate(startDate)),
                where("date", "<=", Timestamp.fromDate(endDate)),
                orderBy("date", currentSortOrder)
            );
            
            const salesSnapshot = await getDocs(salesQuery);
            const tableBody = document.getElementById('salesTableBody');
            if (!tableBody) return;
            
            tableBody.innerHTML = '';
            
            if (salesSnapshot.empty) {
                tableBody.innerHTML = '<tr><td colspan="7" class="no-data">No sales found for this date</td></tr>';
                return;
            }
            
            salesSnapshot.forEach(doc => {
                const sale = doc.data();
                const withinWindow = isWithinExchangeWindow(sale.date);
                
                // Discount badge based on discount type
                let discountBadge = '';
                if (sale.discountType) {
                    if (sale.discountType === 'seniorPWD') {
                        discountBadge = '<span class="discount-badge senior-pwd"><i class="fas fa-id-card"></i> Senior/PWD</span>';
                    } else if (sale.discountType === 'yakap') {
                        discountBadge = '<span class="discount-badge yakap"><i class="fas fa-heart"></i> YAKAP</span>';
                    }
                }
                
                // Only show expiring badge if the sale actually had expiring items
                const hadExpiring = sale.hadExpiringItems ? 
                    '<span class="expiring-sale-badge"><i class="fas fa-clock"></i> Had Expiring</span>' : '';
                
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>
                        <span class="invoice-badge">${sale.invoiceNumber || `#${doc.id.slice(-8)}`}</span>
                        ${hadExpiring}
                        ${discountBadge}
                    </td>
                    <td>${formatDate(sale.date)}</td>
                    <td>${sale.items?.length || 0} items</td>
                    <td>₱${(sale.total || 0).toFixed(2)}</td>
                    <td>${sale.paymentMethod || 'N/A'}</td>
                    <td>${sale.cashierName || 'Unknown'}</td>
                    <td>
                        <button class="btn-icon view-sale" data-id="${doc.id}"><i class="fas fa-eye"></i></button>
                        ${withinWindow && !sale.exchanges ? 
                            `<button class="btn-icon exchange-sale" data-id="${doc.id}"><i class="fas fa-exchange-alt"></i></button>` : ''}
                    </td>
                `;
                tableBody.appendChild(row);
            });
            
        } catch (error) {
            console.error("Error filtering sales:", error);
        }
    });
}

// ==================== SORT TOGGLE ====================

const sortBtn = document.getElementById('sortSalesBtn');
if (sortBtn) {
    sortBtn.addEventListener('click', () => {
        currentSortOrder = currentSortOrder === 'desc' ? 'asc' : 'desc';
        const icon = sortBtn.querySelector('i');
        icon.className = currentSortOrder === 'desc' ? 'fas fa-sort-amount-down' : 'fas fa-sort-amount-up';
        loadSalesHistory(currentSortOrder);
    });
}

// ==================== PDF DOWNLOAD ====================

const downloadPDFBtn = document.getElementById('downloadPDFBtn');
if (downloadPDFBtn) {
    downloadPDFBtn.addEventListener('click', () => {
        alert('PDF download coming soon!');
    });
}

// ==================== UTILITY FUNCTIONS ====================

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

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

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
    }
}

function setupEventListeners() {
    document.querySelectorAll('.close').forEach(btn => {
        btn.addEventListener('click', () => {
            const modal = btn.closest('.modal');
            if (modal) {
                modal.style.display = 'none';
            }
        });
    });
    
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            e.target.style.display = 'none';
        }
    });
}

// Make functions global
window.viewSaleDetails = viewSaleDetails;
window.printReceipt = printReceipt;
window.openExchangeModal = openExchangeModal;
window.closeModal = closeModal;
window.goToExchangeStep = goToExchangeStep;