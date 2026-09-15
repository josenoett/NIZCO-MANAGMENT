        const State = {
            orders: [],
            personal: [],
            expenses: [],
            pagos: [],
            ingresosExtra: [],
            currentEditingOrderId: null,
            currentRole: "Mecánico",
            confirmCallback: null,
            newOrderConcepts: [{ descripcion: '', cantidad: 1, precio: '', categoria: 'mano-obra' }],
            modalEditingConcepts: [],
            quoteItems: [],
            fixedCosts: { renta: 0, servicios: 0, impuestos: 0 },
            sociosReparto: [],
            saldoInicialCaja: { efectivo: 0, banco: 0 },
            categories: ["Gasolina", "Diesel", "Consumibles", "Refacciones", "Nómina", "Renta", "Agua", "Luz", "Internet", "Herramientas", "Publicidad", "Papelería", "Transporte", "Comisiones bancarias", "Impuestos", "Pago de Préstamos / Socios", "Traspaso entre Cuentas (Caja/Banco)", "Otros"],
            extraIncomeCategories: ["Capital de Trabajo", "Crédito o Préstamo", "Aportación de Socios", "Traspaso entre Cuentas (Caja/Banco)", "Otro Ingreso"]
        };

        const Utils = {
            formatter: new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }),

            escapeHtml(value) {
                return String(value ?? '').replace(/[&<>'"]/g, character => ({
                    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
                })[character]);
            },

            parseFechaLocal(fechaValor) {
                if (!fechaValor) return new Date(NaN);
                if (typeof fechaValor === 'string') {
                    const soloFecha = fechaValor.split('T')[0];
                    if (/^\d{4}-\d{2}-\d{2}$/.test(soloFecha) && !fechaValor.includes('T')) {
                        return new Date(soloFecha + 'T12:00:00');
                    }
                }
                return new Date(fechaValor);
            },

            getDaysInRange(startDate, endDate) {
                const MS_PER_DAY = 1000 * 60 * 60 * 24;
                const start = new Date(startDate);
                const end = new Date(endDate);
            
                // Normalizar ambas fechas a medianoche para evitar desfases de horas/milisegundos
                const utcStart = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
                const utcEnd = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
            
                return Math.max(1, Math.floor((utcEnd - utcStart) / MS_PER_DAY) + 1);
            },

            debounce(fn, delay = 300) {
                let timeoutId;
                return (...args) => {
                    clearTimeout(timeoutId);
                    timeoutId = setTimeout(() => fn.apply(this, args), delay);
                };
            },

            setDefaultFechaPago(inputId) {
                const el = document.getElementById(inputId);
                if (!el) return;
                const now = new Date();
                const pad = (n) => String(n).padStart(2, '0');
                const local = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
                el.value = local;
            }
        };

        let chartInstanceCategoria = null;
        let chartInstanceTopServicios = null;
        let chartInstanceMoVsRef = null;

        function showToast(message, isError = false) {
            const container = document.getElementById('toast-container');
            const toast = document.createElement('div');
            toast.className = `px-4 py-2.5 text-xs font-semibold rounded-xl shadow-xl transition-all duration-300 transform translate-y-2 ${isError ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white'}`;
            toast.innerText = message;
            container.appendChild(toast);
            setTimeout(() => { toast.classList.remove('translate-y-2'); }, 10);
            setTimeout(() => { toast.classList.add('opacity-0', 'translate-y-2'); setTimeout(() => toast.remove(), 300); }, 3000);
        }

