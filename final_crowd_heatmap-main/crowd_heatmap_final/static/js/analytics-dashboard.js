// ========== Futuristic Analytics Dashboard ==========

class FuturisticAnalyticsDashboard {
    constructor() {
        this.charts = {};
        this.currentChart = 'monthly';
        this.updateInterval = null;
        this.isLive = false;
        this.init();
    }

    init() {
        this.setupChartToggles();
        this.initializeCharts();
        this.startRealTimeUpdates();
    }

    setupChartToggles() {
        const toggles = document.querySelectorAll('.chart-toggle');
        toggles.forEach(toggle => {
            toggle.addEventListener('click', (e) => {
                const chartType = e.currentTarget.dataset.chart;
                this.switchChart(chartType);
                
                // Update active state
                toggles.forEach(t => t.classList.remove('active'));
                e.currentTarget.classList.add('active');
            });
        });
    }

    switchChart(chartType) {
        this.currentChart = chartType;
        
        // Hide all charts
        document.querySelectorAll('.chart-card').forEach(card => {
            card.classList.remove('active');
        });
        
        // Show selected chart
        const selectedCard = document.getElementById(`${chartType}-chart-card`);
        if (selectedCard) {
            selectedCard.classList.add('active');
        }
        
        // Restart live updates if switching to live
        if (chartType === 'live') {
            this.isLive = true;
            this.startLiveUpdates();
        } else {
            this.isLive = false;
            this.stopLiveUpdates();
        }
    }

    initializeCharts() {
        this.showLoading();
        
        setTimeout(() => {
            this.createMonthlyChart();
            this.createDailyChart();
            this.createTotalChart();
            this.createLiveChart();
            this.hideLoading();
        }, 1500);
    }

    createMonthlyChart() {
        const ctx = document.getElementById('monthlyRevenueChart');
        if (!ctx) return;

        const gradient = ctx.getContext('2d').createLinearGradient(0, 0, 0, 300);
        gradient.addColorStop(0, 'rgba(139, 92, 246, 0.8)');
        gradient.addColorStop(1, 'rgba(59, 130, 246, 0.2)');

        this.charts.monthly = new Chart(ctx, {
            type: 'line',
            data: {
                labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
                datasets: [{
                    label: 'Monthly Revenue',
                    data: [45000, 52000, 48000, 61000, 58000, 67000, 72000, 69000, 75000, 82000, 78000, 85000],
                    borderColor: '#8b5cf6',
                    backgroundColor: gradient,
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 5,
                    pointHoverRadius: 8,
                    pointBackgroundColor: '#8b5cf6',
                    pointBorderColor: '#ffffff',
                    pointBorderWidth: 2
                }, {
                    label: 'Monthly Average',
                    data: [55000, 55000, 55000, 55000, 55000, 55000, 55000, 55000, 55000, 55000, 55000, 55000, 55000],
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    fill: false,
                    tension: 0.4,
                    pointRadius: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                plugins: {
                    legend: {
                        display: true,
                        labels: {
                            color: '#ffffff',
                            font: {
                                size: 12,
                                family: 'Inter, sans-serif'
                            },
                            usePointStyle: true
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15, 12, 41, 0.9)',
                        titleColor: '#ffffff',
                        bodyColor: '#ffffff',
                        borderColor: '#8b5cf6',
                        borderWidth: 1,
                        padding: 12,
                        displayColors: false,
                        callbacks: {
                            label: function(context) {
                                return context.dataset.label + ': ₹' + context.parsed.y.toLocaleString();
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)',
                            borderColor: 'rgba(255, 255, 255, 0.1)'
                        },
                        ticks: {
                            color: '#94a3b8'
                        }
                    },
                    y: {
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)',
                            borderColor: 'rgba(255, 255, 255, 0.1)'
                        },
                        ticks: {
                            color: '#94a3b8',
                            callback: function(value) {
                                return '₹' + value.toLocaleString();
                            }
                        }
                    }
                }
            }
        });

        this.updateCardValues('monthly', 85000, 55000);
    }

    createDailyChart() {
        const ctx = document.getElementById('dailyRevenueChart');
        if (!ctx) return;

        const gradient = ctx.getContext('2d').createLinearGradient(0, 0, 0, 300);
        gradient.addColorStop(0, 'rgba(236, 72, 153, 0.8)');
        gradient.addColorStop(1, 'rgba(236, 72, 153, 0.2)');

        this.charts.daily = new Chart(ctx, {
            type: 'line',
            data: {
                labels: this.getLast7Days(),
                datasets: [{
                    label: 'Daily Revenue',
                    data: [2800, 3200, 2900, 3500, 4100, 3800, 4500],
                    borderColor: '#ec4899',
                    backgroundColor: gradient,
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 5,
                    pointHoverRadius: 8,
                    pointBackgroundColor: '#ec4899',
                    pointBorderColor: '#ffffff',
                    pointBorderWidth: 2
                }, {
                    label: 'Daily Average',
                    data: [3500, 3500, 3500, 3500, 3500, 3500, 3500],
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    fill: false,
                    tension: 0.4,
                    pointRadius: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                plugins: {
                    legend: {
                        display: true,
                        labels: {
                            color: '#ffffff',
                            font: {
                                size: 12,
                                family: 'Inter, sans-serif'
                            }
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15, 12, 41, 0.9)',
                        titleColor: '#ffffff',
                        bodyColor: '#ffffff',
                        borderColor: '#ec4899',
                        borderWidth: 1,
                        padding: 12,
                        callbacks: {
                            label: function(context) {
                                return context.dataset.label + ': ₹' + context.parsed.y.toLocaleString();
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)',
                            borderColor: 'rgba(255, 255, 255, 0.1)'
                        },
                        ticks: {
                            color: '#94a3b8'
                        }
                    },
                    y: {
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)',
                            borderColor: 'rgba(255, 255, 255, 0.1)'
                        },
                        ticks: {
                            color: '#94a3b8',
                            callback: function(value) {
                                return '₹' + value.toLocaleString();
                            }
                        }
                    }
                }
            }
        });

        this.updateCardValues('daily', 4500, 3500);
    }

    createTotalChart() {
        const ctx = document.getElementById('totalRevenueChart');
        if (!ctx) return;

        const gradient = ctx.getContext('2d').createLinearGradient(0, 0, 0, 300);
        gradient.addColorStop(0, 'rgba(16, 185, 129, 0.8)');
        gradient.addColorStop(1, 'rgba(16, 185, 129, 0.2)');

        this.charts.total = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['Q1', 'Q2', 'Q3', 'Q4'],
                datasets: [{
                    label: 'Total Revenue',
                    data: [185000, 198000, 212000, 225000],
                    backgroundColor: gradient,
                    borderColor: '#10b981',
                    borderWidth: 2,
                    borderRadius: 8,
                    barThickness: 40
                }, {
                    label: 'Total Average',
                    data: [180000, 180000, 180000, 180000],
                    backgroundColor: 'rgba(59, 130, 246, 0.3)',
                    borderColor: '#3b82f6',
                    borderWidth: 2,
                    borderRadius: 8,
                    barThickness: 40
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                plugins: {
                    legend: {
                        display: true,
                        labels: {
                            color: '#ffffff',
                            font: {
                                size: 12,
                                family: 'Inter, sans-serif'
                            }
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15, 12, 41, 0.9)',
                        titleColor: '#ffffff',
                        bodyColor: '#ffffff',
                        borderColor: '#10b981',
                        borderWidth: 1,
                        padding: 12,
                        callbacks: {
                            label: function(context) {
                                return context.dataset.label + ': ₹' + context.parsed.y.toLocaleString();
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)',
                            borderColor: 'rgba(255, 255, 255, 0.1)'
                        },
                        ticks: {
                            color: '#94a3b8'
                        }
                    },
                    y: {
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)',
                            borderColor: 'rgba(255, 255, 255, 0.1)'
                        },
                        ticks: {
                            color: '#94a3b8',
                            callback: function(value) {
                                return '₹' + (value / 1000).toFixed(0) + 'k';
                            }
                        }
                    }
                }
            }
        });

        this.updateCardValues('total', 225000, 180000);
    }

    createLiveChart() {
        const ctx = document.getElementById('liveRevenueChart');
        if (!ctx) return;

        const gradient = ctx.getContext('2d').createLinearGradient(0, 0, 0, 300);
        gradient.addColorStop(0, 'rgba(239, 68, 68, 0.8)');
        gradient.addColorStop(1, 'rgba(239, 68, 68, 0.2)');

        this.charts.live = new Chart(ctx, {
            type: 'line',
            data: {
                labels: this.getLast24Hours(),
                datasets: [{
                    label: 'Live Revenue',
                    data: this.generateLiveData(),
                    borderColor: '#ef4444',
                    backgroundColor: gradient,
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    pointBackgroundColor: '#ef4444',
                    pointBorderColor: '#ffffff',
                    pointBorderWidth: 2
                }, {
                    label: 'Average',
                    data: Array(24).fill(150),
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    fill: false,
                    tension: 0.4,
                    pointRadius: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: 750
                },
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                plugins: {
                    legend: {
                        display: true,
                        labels: {
                            color: '#ffffff',
                            font: {
                                size: 12,
                                family: 'Inter, sans-serif'
                            }
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15, 12, 41, 0.9)',
                        titleColor: '#ffffff',
                        bodyColor: '#ffffff',
                        borderColor: '#ef4444',
                        borderWidth: 1,
                        padding: 12,
                        callbacks: {
                            label: function(context) {
                                return context.dataset.label + ': ₹' + context.parsed.y.toLocaleString();
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)',
                            borderColor: 'rgba(255, 255, 255, 0.1)'
                        },
                        ticks: {
                            color: '#94a3b8',
                            maxRotation: 45,
                            minRotation: 45
                        }
                    },
                    y: {
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)',
                            borderColor: 'rgba(255, 255, 255, 0.1)'
                        },
                        ticks: {
                            color: '#94a3b8',
                            callback: function(value) {
                                return '₹' + value.toLocaleString();
                            }
                        }
                    }
                }
            }
        });

        this.updateCardValues('live', 180, 150);
    }

    updateCardValues(chartType, current, average) {
        const card = document.getElementById(`${chartType}-chart-card`);
        if (!card) return;

        const currentValue = card.querySelector('.current-value');
        const avgValue = card.querySelector('.avg-value');
        
        if (currentValue) {
            currentValue.textContent = '₹' + current.toLocaleString();
            this.animateValue(currentValue);
        }
        
        if (avgValue) {
            avgValue.textContent = '₹' + average.toLocaleString();
        }

        // Update stats
        this.updateStats(chartType, current, average);
    }

    updateStats(chartType, current, average) {
        const card = document.getElementById(`${chartType}-chart-card`);
        if (!card) return;

        const statValues = card.querySelectorAll('.stat-value');
        if (statValues.length >= 2) {
            const growth = ((current - average) / average * 100).toFixed(1);
            const isPositive = growth >= 0;
            
            statValues[0].textContent = (isPositive ? '+' : '') + growth + '%';
            statValues[0].className = 'stat-value ' + (isPositive ? 'positive' : '');
            
            if (chartType === 'monthly') {
                statValues[1].textContent = '₹' + Math.max(...this.charts.monthly.data.datasets[0].data).toLocaleString();
            } else if (chartType === 'daily') {
                statValues[1].textContent = '₹' + Math.max(...this.charts.daily.data.datasets[0].data).toLocaleString();
            } else if (chartType === 'total') {
                statValues[0].textContent = '₹' + (225000 / 4).toLocaleString();
                statValues[1].textContent = '₹250,000';
            } else if (chartType === 'live') {
                statValues[1].textContent = '₹' + (current * 24).toLocaleString() + '/day';
            }
        }
    }

    animateValue(element) {
        element.style.transition = 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)';
        element.style.transform = 'scale(1.1)';
        setTimeout(() => {
            element.style.transform = 'scale(1)';
        }, 300);
    }

    getLast7Days() {
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const today = new Date();
        const result = [];
        
        for (let i = 6; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(today.getDate() - i);
            result.push(days[date.getDay()]);
        }
        
        return result;
    }

    getLast24Hours() {
        const hours = [];
        for (let i = 0; i < 24; i++) {
            hours.push(i + ':00');
        }
        return hours;
    }

    generateLiveData() {
        const data = [];
        let base = 120;
        
        for (let i = 0; i < 24; i++) {
            base += (Math.random() - 0.5) * 20;
            base = Math.max(80, Math.min(200, base));
            data.push(Math.round(base));
        }
        
        return data;
    }

    startLiveUpdates() {
        if (this.updateInterval) return;
        
        this.updateInterval = setInterval(() => {
            if (this.isLive && this.charts.live) {
                const chart = this.charts.live;
                const newData = Math.round(120 + (Math.random() - 0.5) * 40);
                
                chart.data.datasets[0].data.shift();
                chart.data.datasets[0].data.push(newData);
                chart.update('none');
                
                // Update live value
                const liveValue = document.querySelector('#live-chart-card .current-value');
                if (liveValue) {
                    liveValue.textContent = '₹' + newData.toLocaleString();
                }
            }
        }, 2000);
    }

    stopLiveUpdates() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    showLoading() {
        const loading = document.getElementById('analytics-loading');
        if (loading) {
            loading.classList.remove('hidden');
        }
    }

    hideLoading() {
        const loading = document.getElementById('analytics-loading');
        if (loading) {
            loading.classList.add('hidden');
        }
    }

    destroy() {
        this.stopLiveUpdates();
        Object.values(this.charts).forEach(chart => {
            if (chart) chart.destroy();
        });
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Check if we're on the dashboard with analytics
    if (document.querySelector('.futuristic-analytics-dashboard')) {
        window.analyticsDashboard = new FuturisticAnalyticsDashboard();
    }
});
