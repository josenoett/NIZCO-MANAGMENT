        let chartInstanceFlujoCaja = null;

        // Guardado con debounce para configuración que se edita tecla por tecla (renta, % de socios),
        // así no se dispara una llamada a Supabase en cada pulsación.
        const debouncedSaveFixedCosts = Utils.debounce(() => {
            API_Service.saveConfigValue('fixed_costs', State.fixedCosts);
        }, 600);
        const debouncedSaveSociosReparto = Utils.debounce(() => {
            API_Service.saveConfigValue('socios_reparto', State.sociosReparto);
        }, 600);

        const Cashflow_Engine = {
            dailyData: [],
            currentView: 'efectivo', // 'efectivo' | 'banco' | 'combinado'
            lastSaldoInicialEfectivo: 0,
            lastSaldoInicialBanco: 0,

            getSaldoInicial(metodo) {
                const s = State.saldoInicialCaja || { efectivo: 0, banco: 0 };
                return metodo === 'banco' ? (parseFloat(s.banco) || 0) : (parseFloat(s.efectivo) || 0);
            },

            updateSaldoInicial() {
                const inputEf = document.getElementById('caja-saldo-inicial-efectivo-input');
                const inputBc = document.getElementById('caja-saldo-inicial-banco-input');
                State.saldoInicialCaja = {
                    efectivo: inputEf ? (parseFloat(inputEf.value) || 0) : 0,
                    banco: inputBc ? (parseFloat(inputBc.value) || 0) : 0
                };
                API_Service.saveConfigValue('saldo_inicial_caja', State.saldoInicialCaja);
                this.recalculate();
            },

            setView(view) {
                this.currentView = view;
                this.updateViewButtons();
                this.render();
            },

            updateViewButtons() {
                const views = ['efectivo', 'banco', 'combinado'];
                views.forEach(v => {
                    const btn = document.getElementById(`caja-view-btn-${v}`);
                    if (!btn) return;
                    if (v === this.currentView) {
                        btn.className = 'px-4 py-2 rounded-lg text-xs font-bold transition bg-white shadow text-slate-900';
                    } else {
                        btn.className = 'px-4 py-2 rounded-lg text-xs font-bold transition text-slate-500 hover:text-slate-700';
                    }
                });

                const subtitle = document.getElementById('caja-chart-subtitle');
                if (subtitle) {
                    const label = this.currentView === 'efectivo' ? 'Efectivo físico' : this.currentView === 'banco' ? 'Banco / Tarjeta' : 'Efectivo + Banco combinados';
                    subtitle.textContent = `Vista: ${label}. Barras: entradas/salidas del día. Línea: saldo acumulado (eje derecho).`;
                }
            },

            handlePresetChange() {
                const preset = document.getElementById('caja-date-preset').value;
                const customDiv = document.getElementById('caja-custom-dates');
                if (preset === 'custom') {
                    customDiv.classList.remove('hidden');
                } else {
                    customDiv.classList.add('hidden');
                    this.recalculate();
                }
            },

            dayKey(d) {
                const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
                return `${y}-${m}-${day}`;
            },

            esEfectivo(metodo) {
                return (metodo || '').trim().toLowerCase() === 'efectivo';
            },

            async recalculate() {
                const section = document.getElementById('tab-flujo-caja');
                if (!section || section.classList.contains('hidden')) return;

                this.updateViewButtons();

                const inputEf = document.getElementById('caja-saldo-inicial-efectivo-input');
                const inputBc = document.getElementById('caja-saldo-inicial-banco-input');
                const saldoInicialEfectivo = this.getSaldoInicial('efectivo');
                const saldoInicialBanco = this.getSaldoInicial('banco');
                if (inputEf && inputEf.value === '') inputEf.value = saldoInicialEfectivo;
                if (inputBc && inputBc.value === '') inputBc.value = saldoInicialBanco;

                const preset = document.getElementById('caja-date-preset').value;
                const { start, end } = Financial_Engine.getDateRange(preset, 'caja-start-date', 'caja-end-date');

                const totalDias = Utils.getDaysInRange(start, end);
                if (totalDias > 92) {
                    showToast('El rango es muy amplio (máx. 92 días) para el detalle diario. Acórtalo un poco.', true);
                    return;
                }

                const buckets = {};
                let cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
                const finalDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
                while (cursor <= finalDay) {
                    buckets[this.dayKey(cursor)] = { ingresoEfectivo: 0, ingresoBanco: 0, egresoEfectivo: 0, egresoBanco: 0 };
                    cursor.setDate(cursor.getDate() + 1);
                }

                const pagosProcesadosIds = new Set();
                State.pagos.forEach(p => {
                    if (p.id && pagosProcesadosIds.has(p.id)) return;
                    if (p.id) pagosProcesadosIds.add(p.id);
                    const pDate = Utils.parseFechaLocal(p.fecha);
                    if (pDate >= start && pDate <= end) {
                        const key = this.dayKey(pDate);
                        if (!buckets[key]) return;
                        const monto = Math.round(parseFloat(p.monto || 0) * 100) / 100;
                        if (this.esEfectivo(p.metodo_pago)) buckets[key].ingresoEfectivo += monto;
                        else buckets[key].ingresoBanco += monto;
                    }
                });

                // Ingresos adicionales: capital de trabajo, créditos/préstamos, aportaciones de socios, etc.
                // Se incluyen en el flujo de caja (sí es dinero que entra), pero NO en el Estado de Resultados/Dashboard,
                // ya que no son ingresos operativos del taller.
                State.ingresosExtra.forEach(i => {
                    const iDate = Utils.parseFechaLocal(i.fecha);
                    if (iDate >= start && iDate <= end) {
                        const key = this.dayKey(iDate);
                        if (!buckets[key]) return;
                        const monto = Math.round(parseFloat(i.monto || 0) * 100) / 100;
                        if (this.esEfectivo(i.metodo_pago)) buckets[key].ingresoEfectivo += monto;
                        else buckets[key].ingresoBanco += monto;
                    }
                });

                State.expenses.forEach(e => {
                    const eDate = Utils.parseFechaLocal(e.fecha);
                    if (eDate >= start && eDate <= end) {
                        const key = this.dayKey(eDate);
                        if (!buckets[key]) return;
                        const monto = Math.round(parseFloat(e.monto || 0) * 100) / 100;
                        // Los ajustes internos de nómina (monto negativo) no son una salida real de caja
                        if (e.categoria === 'Nómina' && monto < 0) return;
                        if (this.esEfectivo(e.metodo_pago)) buckets[key].egresoEfectivo += monto;
                        else buckets[key].egresoBanco += monto;
                    }
                });

                if (supabaseClient) {
                    try {
                        const { data: compras } = await supabaseClient
                            .from('compras_refacciones')
                            .select('costo_neto, total_pagado, metodo_pago, fecha_compra')
                            .gte('fecha_compra', start.toISOString())
                            .lte('fecha_compra', end.toISOString());

                        (compras || []).forEach(c => {
                            const cDate = Utils.parseFechaLocal(c.fecha_compra);
                            const key = this.dayKey(cDate);
                            if (!buckets[key]) return;
                            const monto = Math.round(parseFloat(c.costo_neto || c.total_pagado || 0) * 100) / 100;
                            if (this.esEfectivo(c.metodo_pago)) buckets[key].egresoEfectivo += monto;
                            else buckets[key].egresoBanco += monto;
                        });
                    } catch (e) {
                        console.error('Error al obtener compras de refacciones para flujo de caja:', e);
                    }
                }

                let saldoEfectivo = saldoInicialEfectivo;
                let saldoBanco = saldoInicialBanco;
                const dias = Object.keys(buckets).sort();
                this.dailyData = dias.map(key => {
                    const b = buckets[key];
                    const netoEfectivo = Math.round((b.ingresoEfectivo - b.egresoEfectivo) * 100) / 100;
                    const netoBanco = Math.round((b.ingresoBanco - b.egresoBanco) * 100) / 100;
                    saldoEfectivo = Math.round((saldoEfectivo + netoEfectivo) * 100) / 100;
                    saldoBanco = Math.round((saldoBanco + netoBanco) * 100) / 100;
                    return {
                        fecha: key,
                        ingresoEfectivo: b.ingresoEfectivo, egresoEfectivo: b.egresoEfectivo, netoEfectivo, saldoEfectivo,
                        ingresoBanco: b.ingresoBanco, egresoBanco: b.egresoBanco, netoBanco, saldoBanco,
                        ingresoTotal: Math.round((b.ingresoEfectivo + b.ingresoBanco) * 100) / 100,
                        egresoTotal: Math.round((b.egresoEfectivo + b.egresoBanco) * 100) / 100,
                        netoTotal: Math.round((netoEfectivo + netoBanco) * 100) / 100,
                        saldoTotal: Math.round((saldoEfectivo + saldoBanco) * 100) / 100
                    };
                });

                this.lastSaldoInicialEfectivo = saldoInicialEfectivo;
                this.lastSaldoInicialBanco = saldoInicialBanco;

                this.render();
            },

            // Extrae del registro del día los 4 valores según la vista actual (efectivo/banco/combinado)
            getViewFields(d) {
                if (this.currentView === 'efectivo') {
                    return { ingreso: d.ingresoEfectivo, egreso: d.egresoEfectivo, neto: d.netoEfectivo, saldo: d.saldoEfectivo };
                } else if (this.currentView === 'banco') {
                    return { ingreso: d.ingresoBanco, egreso: d.egresoBanco, neto: d.netoBanco, saldo: d.saldoBanco };
                }
                return { ingreso: d.ingresoTotal, egreso: d.egresoTotal, neto: d.netoTotal, saldo: d.saldoTotal };
            },

            getSaldoInicialVista() {
                if (this.currentView === 'efectivo') return this.lastSaldoInicialEfectivo;
                if (this.currentView === 'banco') return this.lastSaldoInicialBanco;
                return this.lastSaldoInicialEfectivo + this.lastSaldoInicialBanco;
            },

            render() {
                const saldoInicial = this.getSaldoInicialVista();
                const rows = this.dailyData.map(d => this.getViewFields(d));
                const totalIngresos = rows.reduce((a, r) => a + r.ingreso, 0);
                const totalEgresos = rows.reduce((a, r) => a + r.egreso, 0);
                const saldoFinal = rows.length > 0 ? rows[rows.length - 1].saldo : saldoInicial;

                const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
                setText('caja-kpi-saldo-inicial', Utils.formatter.format(saldoInicial));
                setText('caja-kpi-ingresos', Utils.formatter.format(totalIngresos));
                setText('caja-kpi-egresos', Utils.formatter.format(totalEgresos));
                setText('caja-kpi-saldo-final', Utils.formatter.format(saldoFinal));

                const saldoFinalEl = document.getElementById('caja-kpi-saldo-final');
                if (saldoFinalEl) saldoFinalEl.classList.toggle('text-rose-600', saldoFinal < 0);

                const body = document.getElementById('caja-diaria-body');
                if (body) {
                    if (this.dailyData.length === 0) {
                        body.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-400">Sin movimientos en el periodo seleccionado.</td></tr>`;
                    } else {
                        body.innerHTML = this.dailyData.map(d => {
                            const r = this.getViewFields(d);
                            const fechaObj = Utils.parseFechaLocal(d.fecha);
                            const fStr = fechaObj.toLocaleDateString('es-MX', { weekday: 'short', day: '2-digit', month: 'short' });
                            const netoColor = r.neto >= 0 ? 'text-emerald-600' : 'text-rose-600';
                            const saldoColor = r.saldo >= 0 ? 'text-slate-800' : 'text-rose-600';
                            return `
                                <tr class="hover:bg-slate-50 transition border-b border-slate-100">
                                    <td class="py-2.5 px-4 font-semibold text-slate-700 capitalize">${fStr}</td>
                                    <td class="py-2.5 px-4 text-right text-emerald-600 font-medium">${r.ingreso > 0 ? Utils.formatter.format(r.ingreso) : '—'}</td>
                                    <td class="py-2.5 px-4 text-right text-rose-600 font-medium">${r.egreso > 0 ? Utils.formatter.format(r.egreso) : '—'}</td>
                                    <td class="py-2.5 px-4 text-right font-bold ${netoColor}">${Utils.formatter.format(r.neto)}</td>
                                    <td class="py-2.5 px-4 text-right font-bold ${saldoColor}">${Utils.formatter.format(r.saldo)}</td>
                                </tr>
                            `;
                        }).join('');
                    }
                }

                this.renderChart();
            },

            renderChart() {
                if (chartInstanceFlujoCaja) chartInstanceFlujoCaja.destroy();
                const ctx = document.getElementById('chart-flujo-caja');
                if (!ctx) return;

                const rows = this.dailyData.map(d => this.getViewFields(d));

                const labels = this.dailyData.map(d => {
                    const f = Utils.parseFechaLocal(d.fecha);
                    return f.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
                });

                chartInstanceFlujoCaja = new Chart(ctx, {
                    data: {
                        labels,
                        datasets: [
                            {
                                type: 'bar',
                                label: 'Entradas del día',
                                data: rows.map(r => r.ingreso),
                                backgroundColor: '#10b981',
                                borderRadius: 4
                            },
                            {
                                type: 'bar',
                                label: 'Salidas del día',
                                data: rows.map(r => -r.egreso),
                                backgroundColor: '#ef4444',
                                borderRadius: 4
                            },
                            {
                                type: 'line',
                                label: 'Saldo acumulado',
                                data: rows.map(r => r.saldo),
                                borderColor: '#3b82f6',
                                backgroundColor: '#3b82f6',
                                tension: 0.3,
                                yAxisID: 'y1',
                                pointRadius: 2
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        interaction: { mode: 'index', intersect: false },
                        plugins: {
                            legend: { labels: { font: { size: 10 } } },
                            tooltip: {
                                callbacks: {
                                    label: (ctx) => {
                                        const val = ctx.dataset.label === 'Salidas del día' ? Math.abs(ctx.parsed.y) : ctx.parsed.y;
                                        return ` ${ctx.dataset.label}: ${Utils.formatter.format(val)}`;
                                    }
                                }
                            }
                        },
                        scales: {
                            x: { ticks: { font: { size: 10 } } },
                            y: { ticks: { font: { size: 10 } } },
                            y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { font: { size: 10 } } }
                        }
                    }
                });
            }
        };

