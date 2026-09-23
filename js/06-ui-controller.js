const UI_Controller = {
            ordenActivaId: null,

            switchTab(tabId) {
                document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
                document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('text-blue-600', 'bg-blue-50/80'));
                
                const content = document.getElementById(`tab-${tabId}`);
                if(content) content.classList.remove('hidden');
                const btn = document.getElementById(`btn-${tabId}`);
                if(btn) btn.classList.add('text-blue-600', 'bg-blue-50/80');
                
                if (['dashboard','ordenes','personal','cotizaciones','tesoreria','flujo-caja','rendimiento-mecanicos'].includes(tabId)) {
                    API_Service.fetchOrders();
                    API_Service.fetchPersonal();
                    API_Service.fetchExpenses();
                    API_Service.fetchIngresosExtra();
                }

                if (tabId === 'dashboard') {
                    setTimeout(() => {
                        Financial_Engine.recalculate();
                    }, 50);
                }

                if (tabId === 'flujo-caja') {
                    setTimeout(() => {
                        Cashflow_Engine.recalculate();
                    }, 50);
                }
            },

            applyRolePermissions() {
                const elms = ['btn-dashboard', 'btn-personal', 'btn-config', 'btn-cotizaciones', 'btn-tesoreria', 'btn-flujo-caja', 'btn-rendimiento-mecanicos'];
                
                if (State.currentRole === 'Mecánico' || State.currentRole === 'Mecánico Specialist') {
                    elms.forEach(id => {
                        const el = document.getElementById(id);
                        if (el) el.classList.add('hidden');
                    });
                    document.querySelectorAll('.section-finance-view').forEach(el => el.classList.add('hidden'));
            
                } else if (State.currentRole === 'Recepcionista') {
                    ['btn-dashboard', 'btn-config', 'btn-rendimiento-mecanicos'].forEach(id => {
                        const el = document.getElementById(id);
                        if (el) el.classList.add('hidden');
                    });
                    
                    ['btn-personal', 'btn-cotizaciones', 'btn-tesoreria', 'btn-flujo-caja'].forEach(id => {
                        const el = document.getElementById(id);
                        if (el) el.classList.remove('hidden');
                    });
            
                    document.querySelectorAll('.section-finance-view').forEach(el => el.classList.remove('hidden'));
            
                } else if (State.currentRole === 'Contabilidad/Finanzas') {
                    ['btn-config', 'btn-rendimiento-mecanicos'].forEach(id => {
                        const el = document.getElementById(id);
                        if (el) el.classList.add('hidden');
                    });
            
                    ['btn-dashboard', 'btn-personal', 'btn-cotizaciones', 'btn-tesoreria', 'btn-flujo-caja'].forEach(id => {
                        const el = document.getElementById(id);
                        if (el) el.classList.remove('hidden');
                    });
            
                    document.querySelectorAll('.section-finance-view').forEach(el => el.classList.remove('hidden'));
            
                } else {
                    elms.forEach(id => {
                        const el = document.getElementById(id);
                        if (el) el.classList.remove('hidden');
                    });
                    document.querySelectorAll('.section-finance-view').forEach(el => el.classList.remove('hidden'));
                }
            
                this.renderNewOrderConcepts();
                this.renderModalConcepts();
                this.renderOrdersList();
            },

            async downloadCorteCajaPDF() {
                showToast("Generando Reporte Ejecutivo de Entrega de Cuentas...");
            
                const preset = document.getElementById('erp-date-preset').value;
                const { start, end } = Financial_Engine.getDateRange(preset);
                
                const fInicioStr = start.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
                const fFinStr = end.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
            
                const F = await Financial_Engine.computeCoreFinancials(start, end);
                const {
                    totalDays, entradasEfectivo, entradasBanco, salidasEfectivo, salidasBanco,
                    totalIva16Cobrado, totalIvaAcreditablePagado, refaccionesCostBruto, refaccionesCostNeto,
                    egresosManuales, listaGastosPorCategoriaPDF, desgloseMovimientosNoOperativos, netoNoOperativo,
                    entradasNoOperativas, salidasNoOperativas,
                    totalPrestadoHistorico, totalDevueltoHistorico, saldoPrestamosPendiente,
                    costoNominaPeriodo, nominaFinalConDescuentos, desglosePersonal, rentaMensual, serviciosMensuales, impuestosMensuales,
                    rentaProrrateada, serviciosProrrateados, impuestosProrrateados, totalGastosFijosProrrateados,
                    cuentasPorCobrar, totalPendienteCobro, listaProductividad,
                    comprasPorProveedor, refaccionesPeriodo, totalIngresosCobrados, ventasNetasSinIva16,
                    utilidadNetaPL, balanceIvaNeto, esIvaPorPagar, utilidadDisponibleTrasIva, balEfectivo, balBanco
                } = F;


                const sociosReparto = (State.sociosReparto && State.sociosReparto.length > 0) ? State.sociosReparto : [];
                const totalPorcentajeSocios = Math.round(sociosReparto.reduce((acc, s) => acc + (parseFloat(s.porcentaje) || 0), 0) * 10) / 10;
                const repartos = sociosReparto.map(s => ({
                    nombre: s.nombre,
                    porcentaje: parseFloat(s.porcentaje) || 0,
                    monto: utilidadDisponibleTrasIva * ((parseFloat(s.porcentaje) || 0) / 100)
                }));
            
                const printArea = document.createElement('div');
                printArea.className = "bg-white font-sans text-slate-800 text-xs";
                printArea.style.width = "790px";
            
                printArea.innerHTML = `
                    <div class="p-8" style="min-height: 1020px;">
                        <div class="border-b-2 border-slate-900 pb-4 mb-4 flex justify-between items-center">
                            <div>
                                <h1 class="text-xl font-black text-slate-900">BEFIX GARAGE ERP</h1>
                                <p class="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Reporte de Entrega de Cuentas (Página 1: Arqueo de Dinero)</p>
                            </div>
                            <div class="text-right">
                                <span class="bg-slate-100 text-slate-800 text-[10px] font-bold px-3 py-1 rounded-full border border-slate-200">
                                    Rango: ${fInicioStr} - ${fFinStr}
                                </span>
                                <p class="text-[9px] text-slate-400 mt-1">Generado: ${new Date().toLocaleString('es-MX')}</p>
                            </div>
                        </div>
            
                        <div class="grid grid-cols-2 gap-4 mb-4">
                            <div class="bg-slate-50 p-4 rounded-2xl border border-slate-200">
                                <h3 class="font-extrabold text-slate-900 text-xs border-b pb-1 mb-2 uppercase flex justify-between">
                                    <span>💵 CAJA FÍSICA (EFECTIVO)</span>
                                </h3>
                                <div class="flex justify-between text-slate-600 mb-1">
                                    <span>(+) Entradas Efectivo:</span>
                                    <span class="font-bold text-emerald-600">${Utils.formatter.format(entradasEfectivo)}</span>
                                </div>
                                <div class="flex justify-between text-slate-600 mb-1">
                                    <span>(-) Salidas Efectivo:</span>
                                    <span class="font-bold text-rose-600">${Utils.formatter.format(salidasEfectivo)}</span>
                                </div>
                                <div class="flex justify-between text-slate-900 font-black text-xs pt-2 border-t mt-1">
                                    <span>FLUJO NETO DE EFECTIVO:</span>
                                    <span class="text-blue-600">${Utils.formatter.format(balEfectivo)}</span>
                                </div>
                            </div>
            
                            <div class="bg-slate-50 p-4 rounded-2xl border border-slate-200">
                                <h3 class="font-extrabold text-slate-900 text-xs border-b pb-1 mb-2 uppercase flex justify-between">
                                    <span>🏦 CUENTA DE BANCO (SPEI / TARJETA)</span>
                                </h3>
                                <div class="flex justify-between text-slate-600 mb-1">
                                    <span>(+) Entradas Banco:</span>
                                    <span class="font-bold text-emerald-600">${Utils.formatter.format(entradasBanco)}</span>
                                </div>
                                <div class="flex justify-between text-slate-600 mb-1">
                                    <span>(-) Salidas Banco:</span>
                                    <span class="font-bold text-rose-600">${Utils.formatter.format(salidasBanco)}</span>
                                </div>
                                <div class="flex justify-between text-slate-900 font-black text-xs pt-2 border-t mt-1">
                                    <span>FLUJO NETO BANCARIO:</span>
                                    <span class="text-blue-600">${Utils.formatter.format(balBanco)}</span>
                                </div>
                            </div>
                        </div>

                        ${(entradasNoOperativas > 0 || salidasNoOperativas > 0) ? `
                        <div class="mb-4 bg-amber-50 p-3.5 rounded-2xl border border-amber-200">
                            <h3 class="font-bold border-b border-amber-200 pb-1.5 mb-2 uppercase text-[10px] text-amber-900 flex justify-between items-center">
                                <span>🔄 MOVIMIENTOS NO OPERATIVOS DEL PERIODO (PRÉSTAMOS / APORTACIONES / TRASPASOS)</span>
                                <span class="text-xs font-black ${netoNoOperativo >= 0 ? 'text-emerald-700' : 'text-rose-700'}">Neto: ${Utils.formatter.format(netoNoOperativo)}</span>
                            </h3>
                            <p class="text-[9px] text-amber-800 mb-2">Este dinero ya está incluido en las Entradas/Salidas de Efectivo y Banco de arriba (para que la caja física cuadre), pero <strong>NO es venta ni gasto del negocio</strong> — por eso tampoco toca la Utilidad Neta ni el reparto. Se detalla aquí para que quede clara su procedencia.</p>
                            <table class="w-full text-left border-collapse text-[9px]">
                                <thead>
                                    <tr class="bg-amber-100/70 text-amber-900 uppercase font-bold">
                                        <th class="p-1.5">Fecha</th>
                                        <th class="p-1.5">Movimiento</th>
                                        <th class="p-1.5">Categoría</th>
                                        <th class="p-1.5">Concepto</th>
                                        <th class="p-1.5 text-center">Método</th>
                                        <th class="p-1.5 text-right">Monto</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-amber-200">
                                    ${desgloseMovimientosNoOperativos.map(mv => `
                                        <tr>
                                            <td class="p-1.5 text-slate-600">${Utils.parseFechaLocal(mv.fecha).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })}</td>
                                            <td class="p-1.5 font-bold ${mv.tipo.startsWith('(+)') ? 'text-emerald-700' : 'text-rose-700'}">${mv.tipo}</td>
                                            <td class="p-1.5 text-slate-700">${Utils.escapeHtml(mv.categoria)}</td>
                                            <td class="p-1.5 text-slate-500">${Utils.escapeHtml(mv.concepto || '—')}</td>
                                            <td class="p-1.5 text-center text-slate-500">${Utils.escapeHtml(mv.metodo)}</td>
                                            <td class="p-1.5 text-right font-bold text-slate-900">${Utils.formatter.format(mv.monto)}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                        ` : ''}

                        ${Math.abs(saldoPrestamosPendiente) > 0.5 ? `
                        <div class="mb-4 ${saldoPrestamosPendiente > 0 ? 'bg-rose-50 border-rose-200' : 'bg-emerald-50 border-emerald-200'} p-3.5 rounded-2xl border">
                            <h3 class="font-extrabold text-xs border-b ${saldoPrestamosPendiente > 0 ? 'border-rose-200 text-rose-900' : 'border-emerald-200 text-emerald-900'} pb-1.5 mb-2 uppercase flex justify-between items-center">
                                <span>🏦 SALDO DE PRÉSTAMOS DE SOCIOS PENDIENTE (ACUMULADO A LA FECHA)</span>
                            </h3>
                            <div class="grid grid-cols-3 gap-3 text-[10px]">
                                <div class="bg-white p-2 rounded-xl border border-slate-200">
                                    <span class="text-slate-500 font-medium block">Total Prestado (Histórico):</span>
                                    <span class="font-bold text-slate-800">${Utils.formatter.format(totalPrestadoHistorico)}</span>
                                </div>
                                <div class="bg-white p-2 rounded-xl border border-slate-200">
                                    <span class="text-slate-500 font-medium block">Total Ya Devuelto:</span>
                                    <span class="font-bold text-slate-800">${Utils.formatter.format(totalDevueltoHistorico)}</span>
                                </div>
                                <div class="bg-white p-2 rounded-xl border-2 ${saldoPrestamosPendiente > 0 ? 'border-rose-300' : 'border-emerald-300'}">
                                    <span class="text-slate-500 font-medium block">${saldoPrestamosPendiente > 0 ? 'El Taller Todavía Debe:' : 'Saldo a Favor del Taller:'}</span>
                                    <span class="font-black ${saldoPrestamosPendiente > 0 ? 'text-rose-700' : 'text-emerald-700'}">${Utils.formatter.format(Math.abs(saldoPrestamosPendiente))}</span>
                                </div>
                            </div>
                            <p class="text-[9px] ${saldoPrestamosPendiente > 0 ? 'text-rose-700' : 'text-emerald-700'} mt-2">Este saldo es acumulado de todo el historial, no solo de este periodo — refleja lo que falta por regresarle al socio que prestó dinero para el taller.</p>
                        </div>
                        ` : ''}
            
                        <div class="mb-4 bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
                            <h3 class="font-bold border-b pb-1 mb-2 uppercase text-[10px] text-blue-900 flex justify-between items-center">
                                <span>🏢 RESUMEN INFORMATIVO DE RENTA Y GASTOS FIJOS (${totalDays} DÍAS - NO RESTADO DE CAJA/BANCO)</span>
                                <span class="text-xs font-black text-blue-900">${Utils.formatter.format(totalGastosFijosProrrateados)}</span>
                            </h3>
                            <div class="grid grid-cols-3 gap-3 text-[10px]">
                                <div class="bg-white p-2 rounded-xl border border-slate-200 flex justify-between items-center">
                                    <div>
                                        <span class="text-slate-500 font-medium block">Renta Taller:</span>
                                        <span class="text-[8px] text-slate-400">($${rentaMensual.toLocaleString()}/mes)</span>
                                    </div>
                                    <span class="font-bold text-slate-800">${Utils.formatter.format(rentaProrrateada)}</span>
                                </div>
                                <div class="bg-white p-2 rounded-xl border border-slate-200 flex justify-between items-center">
                                    <div>
                                        <span class="text-slate-500 font-medium block">Servicios (Agua/Luz/Net):</span>
                                        <span class="text-[8px] text-slate-400">($${serviciosMensuales.toLocaleString()}/mes)</span>
                                    </div>
                                    <span class="font-bold text-slate-800">${Utils.formatter.format(serviciosProrrateados)}</span>
                                </div>
                                <div class="bg-white p-2 rounded-xl border border-slate-200 flex justify-between items-center">
                                    <div>
                                        <span class="text-slate-500 font-medium block">Impuestos Est.:</span>
                                        <span class="text-[8px] text-slate-400">($${impuestosMensuales.toLocaleString()}/mes)</span>
                                    </div>
                                    <span class="font-bold text-slate-800">${Utils.formatter.format(impuestosProrrateados)}</span>
                                </div>
                            </div>
                        </div>
            
                        <div class="mb-4 bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
                            <h3 class="font-bold border-b pb-1.5 mb-2 uppercase text-[10px] text-purple-800 flex justify-between items-center">
                                <span>📋 RESUMEN INFORMATIVO DE NÓMINA DEL PERIODO (NO RESTADO DE CAJA/BANCO)</span>
                                <span class="text-xs font-black text-purple-900">${Utils.formatter.format(costoNominaPeriodo)}</span>
                            </h3>
                            <table class="w-full text-left border-collapse text-[10px]">
                                <thead>
                                    <tr class="bg-slate-200/60 text-slate-700 uppercase font-bold">
                                        <th class="p-1.5">Colaborador</th>
                                        <th class="p-1.5">Puesto / Rol</th>
                                        <th class="p-1.5 text-center">Sueldo Semanal</th>
                                        <th class="p-1.5 text-center">Días en Periodo</th>
                                        <th class="p-1.5 text-right">Monto Devengado</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-slate-200">
                                    ${desglosePersonal.length === 0 ? '<tr><td colspan="5" class="p-2 text-center text-slate-400">Sin colaboradores activos registrados</td></tr>' : 
                                      desglosePersonal.map(p => `
                                        <tr>
                                            <td class="p-1.5 font-bold text-slate-800">${Utils.escapeHtml(p.nombre)}</td>
                                            <td class="p-1.5 text-slate-600">${Utils.escapeHtml(p.puesto)}</td>
                                            <td class="p-1.5 text-center">${Utils.formatter.format(p.sueldoSemanal)}</td>
                                            <td class="p-1.5 text-center font-bold">${p.dias} días</td>
                                            <td class="p-1.5 text-right font-bold text-slate-900">${Utils.formatter.format(p.monto)}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
            
                    <div style="page-break-before: always;"></div>
            
                    <div class="p-8" style="min-height: 1020px;">
                        <div class="border-b-2 border-slate-900 pb-3 mb-4 flex justify-between items-center">
                            <div>
                                <h2 class="text-lg font-black text-slate-900">ESTADO DE RESULTADOS Y PRODUCTIVIDAD</h2>
                                <p class="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Reporte para Socios (Página 2)</p>
                            </div>
                            <span class="bg-blue-50 text-blue-700 text-[10px] font-bold px-3 py-1 rounded-full border border-blue-200">
                                Periodo: ${fInicioStr} - ${fFinStr}
                            </span>
                        </div>
            
                        <div class="bg-blue-50/60 border border-blue-200 p-4 rounded-2xl mb-5">
                            <h3 class="font-extrabold text-blue-900 text-xs border-b border-blue-200 pb-1 mb-2 uppercase">
                                📊 ESTADO DE RESULTADOS REAL (UTILIDAD NETA REPARTIBLE)
                            </h3>
                            <div class="flex flex-col gap-1.5 text-[11px]">
                                <div class="flex justify-between font-bold text-slate-800">
                                    <span>(+) Ventas Netas Cobradas (Sin IVA 16%):</span>
                                    <span class="text-emerald-600">${Utils.formatter.format(ventasNetasSinIva16)}</span>
                                </div>
                                <div class="flex justify-between text-slate-600 pl-3">
                                    <span>(-) Costo Neto de Refacciones (Sin IVA 8%):</span>
                                    <span class="text-rose-600">${Utils.formatter.format(refaccionesCostNeto)}</span>
                                </div>
                                <div class="flex justify-between text-slate-600 pl-3">
                                    <span>(-) Gastos Directos de Tesorería:</span>
                                    <span class="text-rose-600">${Utils.formatter.format(egresosManuales)}</span>
                                </div>
                                <div class="flex justify-between text-slate-600 pl-3">
                                    <span>(-) Costo Total de Nómina (Neta de Descuentos):</span>
                                    <span class="text-rose-600">${Utils.formatter.format(nominaFinalConDescuentos)}</span>
                                </div>
                                <div class="flex justify-between text-slate-600 pl-3">
                                    <span>(-) Gastos Fijos Operativos Prorrateados (Renta/Servicios):</span>
                                    <span class="text-rose-600">${Utils.formatter.format(totalGastosFijosProrrateados)}</span>
                                </div>
                                
                                <div class="flex justify-between font-black text-xs pt-2 border-t border-blue-200 text-slate-900">
                                    <span>(=) UTILIDAD NETA REAL REPARTIBLE:</span>
                                    <span class="${utilidadNetaPL >= 0 ? 'text-emerald-700' : 'text-rose-700'}">${Utils.formatter.format(utilidadNetaPL)}</span>
                                </div>
            
                                <div class="flex justify-between text-[10px] pt-1.5 border-t border-dashed border-blue-300 ${esIvaPorPagar ? 'text-amber-800' : 'text-emerald-800'} font-semibold">
                                    <span>🏛️ ${esIvaPorPagar ? 'IVA Estimado a Pagar (Cobrado 16% - Pagado 8%):' : 'IVA Estimado a Favor / Acreditable:'}</span>
                                    <span class="font-bold">${Utils.formatter.format(Math.abs(balanceIvaNeto))}</span>
                                </div>

                                <div class="flex justify-between text-[11px] pt-1.5 border-t border-blue-300 font-black text-slate-900">
                                    <span>✅ UTILIDAD DISPONIBLE PARA REPARTIR (DESPUÉS DE APARTAR IVA):</span>
                                    <span class="${utilidadDisponibleTrasIva >= 0 ? 'text-emerald-700' : 'text-rose-700'}">${Utils.formatter.format(utilidadDisponibleTrasIva)}</span>
                                </div>
                            </div>
                        </div>

                        ${repartos.length > 0 ? `
                        <div class="mb-5 bg-emerald-50/60 border border-emerald-200 p-4 rounded-2xl">
                            <h3 class="font-extrabold text-emerald-900 text-xs border-b border-emerald-200 pb-1 mb-2 uppercase flex justify-between items-center">
                                <span>💰 REPARTO DE UTILIDADES ENTRE SOCIOS</span>
                                ${totalPorcentajeSocios !== 100 ? `<span class="text-[9px] font-bold text-amber-700 normal-case">⚠️ Porcentajes suman ${totalPorcentajeSocios}%, no 100%</span>` : ''}
                            </h3>
                            ${utilidadDisponibleTrasIva < 0 ? `
                                <p class="text-[10px] text-rose-700 font-semibold">Este periodo la utilidad disponible fue negativa — no hay monto que repartir.</p>
                            ` : `
                                <table class="w-full text-left border-collapse text-[11px]">
                                    <thead>
                                        <tr class="text-emerald-800 font-bold border-b border-emerald-200">
                                            <th class="pb-1.5">Socio</th>
                                            <th class="pb-1.5 text-center">% de Reparto</th>
                                            <th class="pb-1.5 text-right">Monto a Recibir</th>
                                        </tr>
                                    </thead>
                                    <tbody class="divide-y divide-emerald-100">
                                        ${repartos.map(r => `
                                            <tr>
                                                <td class="py-1.5 font-bold text-slate-800">${Utils.escapeHtml(r.nombre)}</td>
                                                <td class="py-1.5 text-center text-slate-600">${r.porcentaje}%</td>
                                                <td class="py-1.5 text-right font-black text-emerald-700">${Utils.formatter.format(r.monto)}</td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            `}
                        </div>
                        ` : ''}

                        ${listaGastosPorCategoriaPDF.length > 0 ? `
                        <div class="mb-5 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                            <h3 class="font-bold border-b pb-1 mb-2 uppercase text-[10px] text-rose-800 flex justify-between items-center">
                                <span>📑 GASTOS DE TESORERÍA POR CATEGORÍA</span>
                                <span class="text-xs font-black text-rose-900">${Utils.formatter.format(egresosManuales)}</span>
                            </h3>
                            <div class="grid grid-cols-2 gap-x-6 gap-y-1 text-[10px]">
                                ${listaGastosPorCategoriaPDF.map(g => `
                                    <div class="flex justify-between items-center py-0.5 border-b border-dashed border-slate-200">
                                        <span class="text-slate-600">${Utils.escapeHtml(g.categoria)}</span>
                                        <span class="font-bold text-slate-800">${Utils.formatter.format(g.monto)} <span class="text-slate-400 font-normal">(${Math.round((g.monto / egresosManuales) * 100)}%)</span></span>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                        ` : ''}
            
                        <div class="mb-5 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                            <h3 class="font-bold border-b pb-1 mb-2 uppercase text-[10px] text-amber-800 flex justify-between items-center">
                                <span>⏳ CUENTAS POR COBRAR DEL PERIODO (DINERO EN LA CALLE)</span>
                                <span class="text-xs font-black text-amber-900">${Utils.formatter.format(totalPendienteCobro)}</span>
                            </h3>
                            <table class="w-full text-left border-collapse text-[10px]">
                                <thead>
                                    <tr class="bg-slate-200/60 text-slate-700 uppercase font-bold">
                                        <th class="p-1.5">Orden</th>
                                        <th class="p-1.5">Cliente / Auto</th>
                                        <th class="p-1.5 text-right">Total Orden</th>
                                        <th class="p-1.5 text-right">Abonado</th>
                                        <th class="p-1.5 text-right">Saldo Pendiente</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-slate-200">
                                    ${cuentasPorCobrar.length === 0 ? '<tr><td colspan="5" class="p-2 text-center text-slate-400">Excelente: No hay saldo pendiente de cobro en este periodo.</td></tr>' : 
                                      cuentasPorCobrar.map(c => `
                                        <tr>
                                            <td class="p-1.5 font-bold text-slate-900">#${c.id}</td>
                                            <td class="p-1.5">${Utils.escapeHtml(c.cliente)} <span class="text-[9px] text-slate-400">(${Utils.escapeHtml(c.auto)})</span></td>
                                            <td class="p-1.5 text-right">${Utils.formatter.format(c.total)}</td>
                                            <td class="p-1.5 text-right text-emerald-600 font-semibold">${Utils.formatter.format(c.abonado)}</td>
                                            <td class="p-1.5 text-right font-bold text-amber-700">${Utils.formatter.format(c.pendiente)}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
            
                        <div class="grid grid-cols-2 gap-4 mb-8">
                            <div class="bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
                                <h3 class="font-bold border-b pb-1 mb-2 uppercase text-[10px] text-slate-700">🔧 PRODUCTIVIDAD POR MECÁNICO</h3>
                                <table class="w-full text-left text-[9px]">
                                    <thead>
                                        <tr class="font-bold border-b text-slate-500">
                                            <th class="pb-1">Mecánico</th>
                                            <th class="pb-1 text-center">Ord. Concluidas</th>
                                            <th class="pb-1 text-right">M.O. Generada</th>
                                        </tr>
                                    </thead>
                                    <tbody class="divide-y">
                                        ${listaProductividad.map(m => `
                                            <tr>
                                                <td class="py-1 font-semibold">${Utils.escapeHtml(m.nombre)}</td>
                                                <td class="py-1 text-center font-bold">${m.concluidas} / ${m.asignadas}</td>
                                                <td class="py-1 text-right font-bold text-blue-600">${Utils.formatter.format(m.manoObra)}</td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
            
                            <div class="bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
                                <h3 class="font-bold border-b pb-1 mb-2 uppercase text-[10px] text-slate-700">📦 COMPRAS POR PROVEEDOR</h3>
                                <table class="w-full text-left text-[9px]">
                                    <thead>
                                        <tr class="font-bold border-b text-slate-500">
                                            <th class="pb-1">Proveedor</th>
                                            <th class="pb-1 text-right">Monto Total</th>
                                        </tr>
                                    </thead>
                                    <tbody class="divide-y">
                                        ${Object.keys(comprasPorProveedor).length === 0 ? '<tr><td colspan="2" class="p-1 text-center text-slate-400">Sin compras</td></tr>' :
                                          Object.keys(comprasPorProveedor).map(prov => `
                                            <tr>
                                                <td class="py-1 font-semibold">${Utils.escapeHtml(prov)}</td>
                                                <td class="py-1 text-right font-bold text-slate-800">${Utils.formatter.format(comprasPorProveedor[prov])}</td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </div>
            
                        <div class="grid grid-cols-2 gap-12 pt-8 border-t border-slate-300 text-[9px] text-center font-bold text-slate-400">
                            <div>
                                <div class="border-b border-slate-300 w-3/4 mx-auto mb-1"></div>
                                <p>Firma de Entrega / Socio Operativo</p>
                                <p class="text-[8px] font-normal text-slate-400">BEFIX GARAGE ERP</p>
                            </div>
                            <div>
                                <div class="border-b border-slate-300 w-3/4 mx-auto mb-1"></div>
                                <p>Firma de Conformidad / Socio Inversionista</p>
                            </div>
                        </div>
                    </div>
                `;
            
                const opt = {
                    margin: 0,
                    filename: `Reporte_Ejecutivo_Socios_${fInicioStr}_al_${fFinStr}.pdf`,
                    image: { type: 'jpeg', quality: 0.98 },
                    html2canvas: { scale: 2 },
                    jsPDF: { format: 'letter', orientation: 'portrait' }
                };
            
                html2pdf().set(opt).from(printArea).save();
            },

            renderOrdersList() {
                const tbody = document.getElementById('orders-table-body'); if(!tbody) return;
                
                const preset = document.getElementById('erp-date-preset').value;
                const { start, end } = Financial_Engine.getDateRange(preset);
                
                const query = (document.getElementById('search-bar')?.value || '').toLowerCase();
                const filtered = State.orders.filter(o => {
                    const matchQuery = (o.cliente_nombre?.toLowerCase().includes(query) ?? false) || 
                                       (o.auto_placas?.toLowerCase().includes(query) ?? false) || 
                                       (o.auto_marca?.toLowerCase().includes(query) ?? false) || 
                                       (o.auto_modelo?.toLowerCase().includes(query) ?? false) || 
                                       (o.tecnico_asignado?.toLowerCase().includes(query) ?? false);
                    
                    const oDate = Utils.parseFechaLocal(o.fecha_ingreso || o.fecha_registro);
                    const matchFecha = oDate >= start && oDate <= end;
                    
                    return matchQuery && matchFecha;
                });

                if(filtered.length === 0) {
                    document.getElementById('no-orders-message').classList.remove('hidden');
                    tbody.innerHTML = '';
                    return;
                }
                document.getElementById('no-orders-message').classList.add('hidden');

                const rowsHtml = filtered.map(o => {
                    const dIngreso = Utils.parseFechaLocal(o.fecha_ingreso || o.fecha_registro);
                    const dateFormatted = dIngreso.toLocaleDateString('es-MX', {day: '2-digit', month: 'short'});
                    
                    let estadiaTexto = "En taller";
                    if (o.fecha_egreso) {
                        const dEgreso = Utils.parseFechaLocal(o.fecha_egreso);
                        const diffTime = Math.abs(dEgreso - dIngreso);
                        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                        estadiaTexto = `${diffDays} ${diffDays === 1 ? 'día' : 'días'}`;
                    } else if (o.estado === 'Terminado' || o.estado === 'Entregado') {
                        estadiaTexto = "1 día (Histórico)";
                    }

                    let estadoBadgeColor = "bg-slate-100 text-slate-700 border-slate-200"; 
                    switch(o.estado) {
                      case 'Recepcionado': estadoBadgeColor = "bg-blue-50 text-blue-700 border-blue-200"; break;
                      case 'En Diagnóstico': estadoBadgeColor = "bg-purple-50 text-purple-700 border-purple-200"; break;
                      case 'Esperando Refacciones': estadoBadgeColor = "bg-amber-50 text-amber-700 border-amber-200"; break;
                      case 'En reparación': estadoBadgeColor = "bg-indigo-50 text-indigo-700 border-indigo-200"; break;
                      case 'Terminado': estadoBadgeColor = "bg-emerald-50 text-emerald-700 border-emerald-200"; break;
                      case 'Entregado': estadoBadgeColor = "bg-slate-100 text-slate-600 border-slate-300"; break;
                      case 'Cancelada': estadoBadgeColor = "bg-rose-50 text-rose-700 border-rose-200"; break;
                    }
                    
                    const nombreTecnico = o.tecnico_asignado && o.tecnico_asignado.trim() !== '' ? Utils.escapeHtml(o.tecnico_asignado) : 'Sin Asignar';
                    
                    let estadoPagoBadge = '<span class="px-2 py-0.5 text-xs font-semibold bg-rose-50 text-rose-700 rounded-lg border border-rose-200">❌ Pendiente</span>';
                    if (o.estado_pago === 'Pagado') {
                        estadoPagoBadge = `<span class="px-2 py-0.5 text-xs font-bold bg-emerald-50 text-emerald-700 rounded-lg border border-emerald-200">✅ Pagado</span>`;
                    } else if (o.estado_pago === 'Anticipo') {
                        estadoPagoBadge = `<span class="px-2 py-0.5 text-xs font-bold bg-amber-50 text-amber-700 rounded-lg border border-amber-200">💰 Anticipo</span>`;
                    }

                    return `
                        <tr class="hover:bg-slate-50 border-b">
                            <td class="py-3 px-6"><span class="font-bold block">#${o.id}</span><span class="text-[10px] text-slate-400 font-bold">${dateFormatted}</span></td>
                            <td class="py-3 px-6">
                                <span class="font-semibold text-slate-800">${Utils.escapeHtml(o.cliente_nombre)}</span>
                                <p class="text-xs text-slate-400">${Utils.escapeHtml(o.auto_marca)} ${Utils.escapeHtml(o.auto_modelo)} - Placas: <strong>${Utils.escapeHtml(o.auto_placas)}</strong> - <strong>${Number(o.kilometraje) || 0} KM</strong></p>
                                ${(() => {
                                if (!o.requiere_factura) return '';
                                if (o.facturado) {
                                    return `<button onclick="UI_Controller.toggleFacturado(${o.id}, false)" title="Clic para marcar como no facturado" class="inline-block mt-1 px-1.5 py-0.5 text-[9px] font-bold bg-emerald-100 text-emerald-800 rounded border border-emerald-300 uppercase cursor-pointer hover:bg-emerald-200 transition">
                                        ✓ Facturado
                                    </button>`;
                                } else {
                                    return `<button onclick="UI_Controller.toggleFacturado(${o.id}, true)" title="Clic para marcar como emitido/facturado" class="inline-block mt-1 px-1.5 py-0.5 text-[9px] font-bold bg-amber-100 text-amber-800 rounded border border-amber-300 uppercase cursor-pointer hover:bg-amber-200 transition">
                                        ⏳ Factura 16%
                                    </button>`;
                                }
                            })()}
                            </td>
                            <td class="py-3 px-6">
                                <span class="text-xs font-semibold text-slate-700 flex items-center gap-1">
                                    <span class="material-icons text-sm text-slate-400">build</span>
                                    ${nombreTecnico}
                                </span>
                            </td>
                            <td class="py-3 px-6">
                                <span class="text-xs font-bold px-2.5 py-1 rounded-full border block w-fit mb-1 ${estadoBadgeColor}">
                                    ${Utils.escapeHtml(o.estado)}
                                </span>
                                <span class="text-[10px] text-slate-500 font-semibold flex items-center gap-1"><span class="material-icons text-[11px]">schedule</span> ${estadiaTexto}</span>
                            </td>
                            <td class="py-3 px-6">${estadoPagoBadge}</td>
                            <td class="py-3 px-6 section-finance-view font-bold text-slate-700">${Utils.formatter.format(o.total_cobrado)}</td>
                            <td class="py-3 px-6 text-right"><button onclick="UI_Controller.openEditModal(${o.id})" class="text-xs font-bold text-blue-600 hover:underline">Gestionar</button></td>
                        </tr>
                    `;
                }).join('');

                tbody.innerHTML = rowsHtml;
                if(State.currentRole !== 'Administrador') document.querySelectorAll('.section-finance-view').forEach(el => el.classList.add('hidden'));
            },

            handleProdPresetChange() {
                const preset = document.getElementById('prod-date-preset').value;
                const customDiv = document.getElementById('prod-custom-dates');
                if (preset === 'custom') {
                    customDiv.classList.remove('hidden');
                } else {
                    customDiv.classList.add('hidden');
                    this.renderMecanicosStats();
                }
            },

            renderMecanicosStats() {
                const cardsContainer = document.getElementById('mecanicos-cards-container');
                const tbody = document.getElementById('mecanicos-table-body');
                if(!cardsContainer || !tbody) return;

                const preset = document.getElementById('prod-date-preset') ? document.getElementById('prod-date-preset').value : 'this-month';
                const { start, end } = Financial_Engine.getDateRange(preset, 'prod-start-date', 'prod-end-date');
                const targetMechanicVal = document.getElementById('prod-mechanic-filter') ? document.getElementById('prod-mechanic-filter').value : 'ALL';

                let mecanicos = State.personal.filter(p => p.rol && p.rol.includes('Mecánico'));
                
                if (targetMechanicVal !== 'ALL') {
                    mecanicos = mecanicos.filter(p => (p.user_id && p.user_id === targetMechanicVal) || p.id == targetMechanicVal);
                }

                if(mecanicos.length === 0) {
                    cardsContainer.innerHTML = `<div class="col-span-full p-8 text-center text-slate-400 font-medium">No hay mecánicos registrados o coincidentes.</div>`;
                    tbody.innerHTML = `<tr><td colspan="6" class="py-4 text-center text-slate-400">Sin datos de productividad para la selección.</td></tr>`;
                    return;
                }

                let cardsHtml = '';
                let rowsHtml = '';

                mecanicos.forEach(m => {
                    const ordenesAsignadas = State.orders.filter(o => {
                        if (o.estado === 'Cancelada') return false;
                        const oDate = Utils.parseFechaLocal(o.fecha_ingreso || o.fecha_registro);
                        const isMec = (o.tecnico_user_id && o.tecnico_user_id === m.user_id) || (o.tecnico_asignado && o.tecnico_asignado.toLowerCase() === m.nombre?.toLowerCase());
                        return isMec && (oDate >= start && oDate <= end);
                    });

                    const ordenesTerminadas = ordenesAsignadas.filter(o => o.estado === 'Terminado' || o.estado === 'Entregado');
                    
                    let manoObraTotal = 0;
                    let produccionTotal = 0;

                    ordenesTerminadas.forEach(o => {
                        manoObraTotal += parseFloat(o.costo_mano_obra || 0);
                        produccionTotal += parseFloat(o.total_cobrado || 0);
                    });

                    const eficiencia = ordenesAsignadas.length > 0 ? ((ordenesTerminadas.length / ordenesAsignadas.length) * 100).toFixed(0) : 0;

                    cardsHtml += `
                        <div class="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm flex flex-col gap-4">
                            <div class="flex items-center justify-between border-b border-slate-100 pb-3">
                                <div class="flex items-center gap-3">
                                    <div class="bg-blue-50 text-blue-600 p-2.5 rounded-2xl">
                                        <span class="material-icons">engineering</span>
                                    </div>
                                    <div>
                                        <h3 class="font-bold text-slate-900 text-sm">${Utils.escapeHtml(m.nombre)}</h3>
                                        <p class="text-xs text-slate-400">Técnico Mecánico</p>
                                    </div>
                                </div>
                                <span class="text-xs font-black px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    ${eficiencia}% Efic.
                                </span>
                            </div>

                            <div class="grid grid-cols-2 gap-3">
                                <div class="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                                    <p class="text-[10px] font-bold text-slate-400 uppercase">Órdenes Asignadas</p>
                                    <p class="text-lg font-black text-slate-800">${ordenesAsignadas.length}</p>
                                </div>
                                <div class="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                                    <p class="text-[10px] font-bold text-slate-400 uppercase">Órdenes Concluidas</p>
                                    <p class="text-lg font-black text-emerald-600">${ordenesTerminadas.length}</p>
                                </div>
                            </div>

                            <div class="pt-2 border-t border-slate-100 flex flex-col gap-1.5 section-finance-view">
                                <div class="flex justify-between text-xs">
                                    <span class="text-slate-500">Prod. Mano de Obra:</span>
                                    <span class="font-bold text-slate-800">${Utils.formatter.format(manoObraTotal)}</span>
                                </div>
                                <div class="flex justify-between text-xs">
                                    <span class="text-slate-500">Producción Total Órdenes:</span>
                                    <span class="font-bold text-blue-600">${Utils.formatter.format(produccionTotal)}</span>
                                </div>
                            </div>
                        </div>
                    `;

                    rowsHtml += `
                        <tr class="border-b hover:bg-slate-50">
                            <td class="py-3 px-4 font-bold text-slate-800">${Utils.escapeHtml(m.nombre)}</td>
                            <td class="py-3 px-4 text-center font-semibold text-slate-600">${ordenesAsignadas.length}</td>
                            <td class="py-3 px-4 text-center font-extrabold text-emerald-600">${ordenesTerminadas.length}</td>
                            <td class="py-3 px-4 text-center">
                                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-600 border border-blue-100">
                                    ${eficiencia}%
                                </span>
                            </td>
                            <td class="py-3 px-4 text-right font-bold text-slate-800 section-finance-view">${Utils.formatter.format(manoObraTotal)}</td>
                            <td class="py-3 px-4 text-right font-black text-blue-600 section-finance-view">${Utils.formatter.format(produccionTotal)}</td>
                        </tr>
                    `;
                });

                cardsContainer.innerHTML = cardsHtml;
                tbody.innerHTML = rowsHtml;

                if(State.currentRole !== 'Administrador') document.querySelectorAll('.section-finance-view').forEach(el => el.classList.add('hidden'));
            },

            renderPersonalList() {
                const tbody = document.getElementById('personal-table-body'); if(!tbody) return;
                const rowsHtml = State.personal.map(p => {
                    const fIngreso = p.fecha_ingreso ? Utils.parseFechaLocal(p.fecha_ingreso).toLocaleDateString('es-MX', {day:'2-digit', month:'short', year:'numeric'}) : 'No reg.';
                    const fEgreso = p.fecha_egreso ? Utils.parseFechaLocal(p.fecha_egreso).toLocaleDateString('es-MX', {day:'2-digit', month:'short', year:'numeric'}) : 'Presente';
                    const activo = !p.fecha_egreso;
            
                    return `
                        <tr class="border-b text-xs hover:bg-slate-50 transition">
                            <td class="py-3 pr-4">
                                <span class="font-bold text-slate-800 block">${Utils.escapeHtml(p.nombre)}</span>
                                <span class="text-[9px] text-slate-400 font-semibold">📅 ${fIngreso} - ${fEgreso}</span>
                            </td>
                            <td class="py-3 px-4 text-slate-500">${Utils.escapeHtml(p.rol)}</td>
                            <td class="py-3 px-4 font-semibold text-emerald-700">${p.sueldo !== undefined ? Utils.formatter.format(p.sueldo) : '***'}</td>
                            <td class="py-3 px-4">
                                <span class="px-2 py-0.5 rounded-full text-[9px] font-bold ${activo ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}">
                                    ${activo ? 'Activo' : 'Baja'}
                                </span>
                            </td>
                            <td class="py-3 text-right">
                                <div class="flex items-center justify-end gap-1">
                                    <button onclick="UI_Controller.openPersonalModal(${p.id})" class="p-1 text-slate-400 hover:text-blue-600 transition" title="Editar / Dar de baja">
                                        <span class="material-icons text-base">edit</span>
                                    </button>
                                    ${activo ? `
                                        <button onclick="UI_Controller.registrarBajaDirecta(${p.id})" class="p-1 text-amber-500 hover:text-amber-700 transition" title="Registrar baja hoy">
                                            <span class="material-icons text-base">event_busy</span>
                                        </button>
                                    ` : ''}
                                    <button onclick="UI_Controller.handleDeletePersonal(${p.id})" class="p-1 text-slate-300 hover:text-rose-600 transition" title="Borrar Físicamente">
                                        <span class="material-icons text-base">delete</span>
                                    </button>
                                </div>
                            </td>
                        </tr>
                    `;
                }).join('');
                tbody.innerHTML = rowsHtml;
            },

            openPersonalModal(id) {
                const p = State.personal.find(x => x.id === id);
                if (!p) return;
            
                document.getElementById('edit-personal-id').value = p.id;
                document.getElementById('edit-personal-nombre').value = p.nombre || '';
                document.getElementById('edit-personal-rol').value = p.rol || 'Mecánico';
                document.getElementById('edit-personal-sueldo').value = p.sueldo || 0;
                document.getElementById('edit-personal-fecha-ingreso').value = p.fecha_ingreso ? p.fecha_ingreso.split('T')[0] : '';
                document.getElementById('edit-personal-fecha-egreso').value = p.fecha_egreso ? p.fecha_egreso.split('T')[0] : '';
            
                document.getElementById('modal-edit-personal').classList.remove('hidden');
            },
            
            closePersonalModal() {
                document.getElementById('modal-edit-personal').classList.add('hidden');
            },
            
            clearFechaEgresoModal() {
                document.getElementById('edit-personal-fecha-egreso').value = '';
            },
            
            async handleUpdatePersonal(e) {
                e.preventDefault();
                const id = document.getElementById('edit-personal-id').value;
                const nombre = document.getElementById('edit-personal-nombre').value;
                const rol = document.getElementById('edit-personal-rol').value;
                const sueldo = parseFloat(document.getElementById('edit-personal-sueldo').value) || 0;
                const fecha_ingreso = document.getElementById('edit-personal-fecha-ingreso').value;
                const fecha_egreso = document.getElementById('edit-personal-fecha-egreso').value || null;
            
                const { error } = await supabaseClient
                    .from('personal')
                    .update({ nombre, rol, sueldo, fecha_ingreso, fecha_egreso })
                    .eq('id', Number(id));
            
                if (error) {
                    showToast("Error al actualizar personal: " + error.message, true);
                    return;
                }
            
                showToast("Datos de personal actualizados.");
                this.closePersonalModal();
                API_Service.fetchPersonal(true);
            },
            
            registrarBajaDirecta(id) {
                const p = State.personal.find(x => x.id === id);
                if (!p) return;
            
                customConfirm(`¿Dar de baja a ${p.nombre}?`, "Se asentará la fecha de hoy como fecha de egreso.", async () => {
                    const hoy = new Date().toISOString().split('T')[0];
                    const { error } = await supabaseClient
                        .from('personal')
                        .update({ fecha_egreso: hoy })
                        .eq('id', Number(id));
            
                    if (error) {
                        showToast("No fue posible dar de baja: " + error.message, true);
                        return;
                    }
            
                    showToast(`${p.nombre} ha sido registrado de baja.`);
                    API_Service.fetchPersonal(true);
                });
            },
            
            populateTecnicosDropdowns() {
                const fSel = document.getElementById('form-tecnico'), mSel = document.getElementById('modal-tecnico'), pSel = document.getElementById('prod-mechanic-filter');
                if(!fSel || !mSel) return;

                // Solo mecánicos activos (sin fecha de baja) para asignar trabajo nuevo.
                const mecOptionsActivos = State.personal
                    .filter(p => p.rol && p.rol.includes('Mecánico') && !p.fecha_egreso)
                    .map(m => {
                        const val = Utils.escapeHtml(m.user_id || m.id);
                        return `<option value="${val}">🔧 ${Utils.escapeHtml(m.nombre)}</option>`;
                    })
                    .join('');

                // Todos los mecánicos (activos + dados de baja) para el filtro de reportes históricos.
                const mecOptionsTodos = State.personal
                    .filter(p => p.rol && p.rol.includes('Mecánico'))
                    .map(m => {
                        const val = Utils.escapeHtml(m.user_id || m.id);
                        const etiquetaBaja = m.fecha_egreso ? ' (Baja)' : '';
                        return `<option value="${val}">🔧 ${Utils.escapeHtml(m.nombre)}${etiquetaBaja}</option>`;
                    })
                    .join('');

                const html = '<option value="">👤 Sin Asignar</option>' + mecOptionsActivos;
                const htmlFilter = '<option value="ALL">👥 Todos los Mecánicos</option>' + mecOptionsTodos;

                fSel.innerHTML = html; 
                mSel.innerHTML = html;
                if (pSel) pSel.innerHTML = htmlFilter;
            },

            populateQuoteOrdersDropdown() {
                const loader = document.getElementById('quote-order-loader'); if(!loader) return;
                const options = State.orders
                    .map(o => `<option value="${Number(o.id)}">Orden #${Number(o.id)} - ${Utils.escapeHtml(o.cliente_nombre)}</option>`)
                    .join('');
                loader.innerHTML = '<option value="">-- Seleccionar Orden --</option>' + options;
            },

            populateCategoriesDropdown() {
                const cSel = document.getElementById('expense-category'); if(!cSel) return;
                cSel.innerHTML = State.categories.map(cat => `<option value="${cat}">${cat}</option>`).join('');

                const eSel = document.getElementById('extra-income-category');
                if (eSel) eSel.innerHTML = State.extraIncomeCategories.map(cat => `<option value="${cat}">${cat}</option>`).join('');
            },

            renderTreasuryData() {
                const incomeBody = document.getElementById('treasury-income-body');
                if(incomeBody) {
                    incomeBody.innerHTML = State.pagos.map(p => {
                        const amt = parseFloat(p.monto || 0);
                        const pFecha = Utils.parseFechaLocal(p.fecha).toLocaleDateString('es-MX', {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'});
                        return `
                            <tr class="border-b">
                                <td class="py-2 text-slate-500 font-medium">${pFecha}</td>
                                <td class="py-2 font-bold">#${Number(p.orden_id)}</td>
                                <td class="py-2">
                                    <div class="flex flex-col gap-0.5">
                                        <span class="w-fit px-1.5 py-0.5 text-[8px] font-bold rounded bg-emerald-50 text-emerald-700 uppercase">${Utils.escapeHtml(p.tipo)}</span>
                                        <span class="text-[9px] text-slate-500 font-medium">${Utils.escapeHtml(p.metodo_pago)}</span>
                                    </div>
                                </td>
                                <td class="py-2 text-right font-bold text-emerald-600">${Utils.formatter.format(amt)}</td>
                            </tr>`;
                    }).join('');
                }

                const extraIncomeBody = document.getElementById('treasury-extra-income-body');
                if (extraIncomeBody) {
                    if (State.ingresosExtra.length === 0) {
                        extraIncomeBody.innerHTML = `<tr><td colspan="4" class="py-3 text-center text-slate-400">Sin ingresos adicionales registrados.</td></tr>`;
                    } else {
                        extraIncomeBody.innerHTML = State.ingresosExtra.map(i => {
                            const amt = parseFloat(i.monto || 0);
                            const iFecha = Utils.parseFechaLocal(i.fecha).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
                            return `
                                <tr class="border-b">
                                    <td class="py-2 text-slate-500 font-medium">${iFecha}</td>
                                    <td class="py-2 font-bold">${Utils.escapeHtml(i.concepto)}<span class="text-[10px] text-emerald-600 font-bold block">${Utils.escapeHtml(i.categoria)}</span></td>
                                    <td class="py-2 text-slate-400">${Utils.escapeHtml(i.metodo_pago)}</td>
                                    <td class="py-2 text-right font-bold text-emerald-600">${Utils.formatter.format(amt)}</td>
                                </tr>`;
                        }).join('');
                    }
                }

                const expenseBody = document.getElementById('treasury-expenses-body');
                if(expenseBody) {
                    expenseBody.innerHTML = State.expenses.map(e => {
                        const amt = parseFloat(e.monto || 0);
                        const textMonto = amt < 0 ? `+${Utils.formatter.format(Math.abs(amt))} (Desc.)` : `-${Utils.formatter.format(amt)}`;
                        const classMonto = amt < 0 ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold';
                        const badgeCfdi = e.tiene_cfdi ? '<span class="ml-1 text-[8px] bg-blue-100 text-blue-700 font-bold px-1 rounded">CFDI</span>' : '';
                        // 1. Obtener el ID del usuario que creó el registro en Supabase
                        const usuarioId = e.user_id || e.created_by || e.registrado_por;
                        
                        // 2. Buscar al colaborador en la lista de personal usando su ID o correo
                        const usuarioEncontrado = State.personal.find(p => 
                            (p.user_id && p.user_id === usuarioId) || 
                            (p.id && p.id == usuarioId) ||
                            (p.email && p.email === usuarioId)
                        );
                        
                        // 3. Si encuentra al usuario, muestra su nombre; si no, muestra quien registró el dato o 'Histórico'
                        const usuarioCaptura = usuarioEncontrado ? usuarioEncontrado.nombre : (e.registrado_por || 'Histórico / S/I');
                
                        return `
                            <tr class="border-b">
                                <td class="py-2 font-medium">${Utils.escapeHtml(e.fecha)}</td>
                                <td class="py-2 font-bold">${Utils.escapeHtml(e.concepto)}${badgeCfdi}<span class="text-[10px] text-rose-600 font-bold block">${Utils.escapeHtml(e.categoria)}</span></td>
                                <td class="py-2 text-slate-400">${Utils.escapeHtml(e.metodo_pago)}</td>
                                <td class="py-2 font-semibold text-slate-700">
                                    <span class="px-2 py-0.5 rounded bg-slate-100 text-[10px] font-bold text-slate-600 border border-slate-200">
                                        👤 ${Utils.escapeHtml(usuarioCaptura)}
                                    </span>
                                </td>
                                <td class="py-2 text-right ${classMonto}">${textMonto}</td>
                            </tr>`;
                    }).join('');
                }
            },

            async handleCreateExpense(e) {
                e.preventDefault();
                const montoTotal = parseFloat(document.getElementById('expense-amount').value) || 0;
                const tieneCfdi = document.getElementById('expense-cfdi').checked;
                // IVA de compras/gastos: tasa 8% (Zona Fronteriza). Las ventas a clientes sí van al 16%.
                const ivaCalculado = tieneCfdi ? Math.round((montoTotal - (montoTotal / 1.08)) * 100) / 100 : 0;

                const expense = {
                    fecha: document.getElementById('expense-date').value,
                    monto: montoTotal,
                    categoria: document.getElementById('expense-category').value,
                    metodo_pago: document.getElementById('expense-method').value,
                    concepto: document.getElementById('expense-concept').value,
                    description: document.getElementById('expense-description').value || '',
                    observaciones: document.getElementById('expense-notes').value || '',
                    tiene_cfdi: tieneCfdi,
                    iva: ivaCalculado,
                    registrado_por: document.getElementById('user-display-name')?.innerText || 'Administrador'
                };

                const { error } = await supabaseClient.from('gastos').insert([expense]);
                if(error) { showToast("Error Supabase: " + error.message, true); return; }

                showToast("Gasto asentado en tesorería.");
                document.getElementById('expense-form').reset();
                document.getElementById('expense-date').value = new Date().toISOString().split('T')[0];
                API_Service.fetchExpenses(true);
            },

            async handleCreateIngresoExtra(e) {
                e.preventDefault();
                const ingreso = {
                    fecha: document.getElementById('extra-income-date').value,
                    monto: parseFloat(document.getElementById('extra-income-amount').value) || 0,
                    categoria: document.getElementById('extra-income-category').value,
                    metodo_pago: document.getElementById('extra-income-method').value,
                    concepto: document.getElementById('extra-income-concept').value,
                    observaciones: document.getElementById('extra-income-notes').value || '',
                    registrado_por: document.getElementById('user-display-name')?.innerText || 'Administrador'
                };

                const { error } = await supabaseClient.from('ingresos_extra').insert([ingreso]);
                if (error) { showToast("Error Supabase: " + error.message, true); return; }

                showToast("Ingreso adicional asentado en tesorería.");
                document.getElementById('extra-income-form').reset();
                document.getElementById('extra-income-date').value = new Date().toISOString().split('T')[0];
                API_Service.fetchIngresosExtra(true);
            },

            async handleCreateTraspaso(e) {
                e.preventDefault();
                const fecha = document.getElementById('transfer-date').value;
                const monto = parseFloat(document.getElementById('transfer-amount').value) || 0;
                const direccion = document.getElementById('transfer-direction').value;
                const notas = document.getElementById('transfer-notes').value || '';
                const registrador = document.getElementById('user-display-name')?.innerText || 'Administrador';
                const CATEGORIA_TRASPASO = "Traspaso entre Cuentas (Caja/Banco)";

                const metodoOrigen = direccion === 'caja-a-banco' ? 'Efectivo' : 'Transferencia';
                const metodoDestino = direccion === 'caja-a-banco' ? 'Transferencia' : 'Efectivo';
                const conceptoBase = direccion === 'caja-a-banco' ? 'Depósito de caja a banco' : 'Retiro de banco a caja';

                const gastoSalida = {
                    fecha, monto,
                    categoria: CATEGORIA_TRASPASO,
                    metodo_pago: metodoOrigen,
                    concepto: conceptoBase,
                    description: '',
                    observaciones: notas,
                    tiene_cfdi: false,
                    iva: 0,
                    registrado_por: registrador
                };

                const ingresoEntrada = {
                    fecha, monto,
                    categoria: CATEGORIA_TRASPASO,
                    metodo_pago: metodoDestino,
                    concepto: conceptoBase,
                    observaciones: notas,
                    registrado_por: registrador
                };

                const [resGasto, resIngreso] = await Promise.all([
                    supabaseClient.from('gastos').insert([gastoSalida]),
                    supabaseClient.from('ingresos_extra').insert([ingresoEntrada])
                ]);

                if (resGasto.error || resIngreso.error) {
                    showToast("Error Supabase: " + (resGasto.error?.message || resIngreso.error?.message), true);
                    return;
                }

                showToast("Traspaso registrado en ambas cuentas.");
                document.getElementById('transfer-form').reset();
                document.getElementById('transfer-date').value = new Date().toISOString().split('T')[0];
                API_Service.fetchExpenses(true);
                API_Service.fetchIngresosExtra(true);
            },

            addNewOrderConceptRow() { State.newOrderConcepts.push({ descripcion: '', cantidad: 1, precio: 0, categoria: 'refacciones' }); this.renderNewOrderConcepts(); },
            deleteNewOrderConceptRow(idx) { State.newOrderConcepts.splice(idx, 1); this.renderNewOrderConcepts(); },
            updateNewOrderConceptRow(idx, field, val) {
                if(field=='cantidad') State.newOrderConcepts[idx].cantidad = parseInt(val)||1;
                else if(field=='precio') State.newOrderConcepts[idx].precio = parseFloat(val)||0;
                else State.newOrderConcepts[idx][field] = val;
                this.calculateNewOrderTotals();
            },
            calculateNewOrderTotals() {
                let m=0, r=0; State.newOrderConcepts.forEach(c=>{ if(c.categoria==='mano-obra') m+=c.cantidad*c.precio; else r+=c.cantidad*c.precio; });
                let subtotal = m + r;
                let requiereFactura = document.getElementById('form-requiere-factura').checked;
                let iva = requiereFactura ? subtotal * 0.16 : 0;
                let total = subtotal + iva;

                document.getElementById('new-order-total-mano').innerText = Utils.formatter.format(m);
                document.getElementById('new-order-total-ref').innerText = Utils.formatter.format(r);
                document.getElementById('new-order-total-general').innerText = Utils.formatter.format(total);
            },
            renderNewOrderConcepts() {
                const c = document.getElementById('new-order-concepts-container'); if(!c) return;
                c.innerHTML = State.newOrderConcepts.map((item, idx) => {
                    const precioDisplay = (item.precio === 0 || item.precio === '') ? '' : item.precio;
                    return `
                        <div class="flex gap-2 bg-white border p-2 rounded-xl">
                            <input type="text" value="${Utils.escapeHtml(item.descripcion)}" oninput="UI_Controller.updateNewOrderConceptRow(${idx},'descripcion',this.value)" placeholder="Concepto (Ej. Cambio de balatas)" class="flex-1 text-xs p-1 focus:outline-none">
                            <select onchange="UI_Controller.updateNewOrderConceptRow(${idx},'categoria',this.value)" class="text-xs bg-white border rounded"><option value="refacciones" ${item.categoria==='refacciones'?'selected':''}>Refacc.</option><option value="mano-obra" ${item.categoria==='mano-obra'?'selected':''}>Mano Obra</option></select>
                            <input type="number" step="any" value="${Number(item.cantidad) || 0}" oninput="UI_Controller.updateNewOrderConceptRow(${idx},'cantidad',this.value)" class="w-10 text-center text-xs border rounded focus:outline-none">
                            <input type="number" step="any" value="${Number(precioDisplay) || ''}" placeholder="0.00" oninput="UI_Controller.updateNewOrderConceptRow(${idx},'precio',this.value)" class="w-20 text-right text-xs border rounded focus:outline-none ${State.currentRole==='Mecánico'?'hidden':''}">
                            <button type="button" onclick="UI_Controller.deleteNewOrderConceptRow(${idx})" class="text-rose-500"><span class="material-icons text-sm">delete</span></button>
                        </div>`;
                }).join('');
                this.calculateNewOrderTotals();
            },

            async handleCreateOrder(e) {
                e.preventDefault();
                let m=0, r=0; State.newOrderConcepts.forEach(c=>{ if(c.categoria==='mano-obra') m+=c.cantidad*c.precio; else r+=c.cantidad*c.precio; });
                const manualDate = document.getElementById('form-fecha-ingreso').value;
                const isoDate = manualDate ? Utils.parseFechaLocal(manualDate).toISOString() : new Date().toISOString();

                let subtotal = m + r;
                let requiereFactura = document.getElementById('form-requiere-factura').checked;
                let ivaCalculado = requiereFactura ? subtotal * 0.16 : 0;
                let granTotal = subtotal + ivaCalculado;

                const initEstadoPago = document.getElementById('form-estado-pago').value;
                const initMetodoPago = initEstadoPago !== 'Pendiente' ? document.getElementById('form-metodo-pago').value : '';
                
                let montoAbonado = 0;
                if (initEstadoPago === 'Pagado') montoAbonado = granTotal;
                else if (initEstadoPago === 'Anticipo') montoAbonado = parseFloat(document.getElementById('form-anticipo-monto').value) || 0;

                const targetUserVal = document.getElementById('form-tecnico').value || null;
                const mecObj = State.personal.find(p => (p.user_id && p.user_id === targetUserVal) || p.id == targetUserVal);

                const order = {
                    cliente_nombre: document.getElementById('form-cliente-nombre').value,
                    cliente_telefono: document.getElementById('form-cliente-telefono').value,
                    auto_marca: document.getElementById('form-auto-marca').value,
                    auto_modelo: document.getElementById('form-auto-modelo').value,
                    auto_placas: document.getElementById('form-auto-placas').value.toUpperCase(),
                    kilometraje: parseInt(document.getElementById('form-kilometraje').value) || 0,
                    falla_reportada: document.getElementById('form-falla-reportada').value,
                    tecnico_user_id: mecObj ? (mecObj.user_id || null) : null,
                    tecnico_asignado: mecObj ? mecObj.nombre : 'Sin Asignar',
                    diagnostico_tecnico: '', 
                    estado: 'Recepcionado', 
                    costo_mano_obra: m, 
                    costo_refacciones: r, 
                    total_cobrado: granTotal, 
                    estado_pago: initEstadoPago, 
                    metodo_pago: initMetodoPago,
                    fecha_ingreso: isoDate,
                    fecha_egreso: null,
                    requiere_factura: requiereFactura,
                    total_iva: ivaCalculado,
                    conceptos: JSON.stringify(State.newOrderConcepts)
                };

                const { data: createdOrder, error } = await supabaseClient
                    .from('ordenes_trabajo')
                    .insert([order])
                    .select('id')
                    .single(); 

                if (error) { showToast("Error Supabase: " + error.message, true); return; }

                if (montoAbonado > 0 && createdOrder) {
                    const fechaPagoInput = document.getElementById('form-fecha-pago').value;
                    const fechaPago = fechaPagoInput ? new Date(fechaPagoInput).toISOString() : new Date().toISOString();

                    const { error: errorPago } = await supabaseClient.from('pagos').insert([{
                        orden_id: createdOrder.id,
                        monto: montoAbonado,
                        metodo_pago: initMetodoPago || 'Efectivo',
                        tipo: initEstadoPago === 'Anticipo' ? 'anticipo' : 'pago_final',
                        fecha: fechaPago,
                        observaciones: 'Pago registrado al ingresar orden'
                    }]);

                    if (errorPago) {
                        showToast("Orden creada, pero el pago no se pudo registrar: " + errorPago.message, true);
                    } else {
                        await API_Service.fetchPagos(true);
                    }
                }

                showToast("Orden de trabajo registrada correctamente."); 
                State.newOrderConcepts = [{ descripcion: '', cantidad: 1, precio: '', categoria: 'mano-obra' }];
                document.getElementById('new-order-form').reset();
                document.getElementById('form-requiere-factura').checked = false;
                document.getElementById('form-estado-pago').value = 'Pendiente';
                document.getElementById('form-anticipo-monto-container').style.display = 'none';
                document.getElementById('form-metodo-pago-container').style.display = 'none';
                document.getElementById('form-fecha-pago-container').style.display = 'none';
                document.getElementById('form-fecha-pago').value = '';
                document.getElementById('form-fecha-ingreso').value = new Date().toISOString().split('T')[0];
                API_Service.fetchOrders(true); this.switchTab('ordenes');
            },

            async handleCreatePersonal(e) {
                e.preventDefault();
                
                const nombre = document.getElementById('personal-nombre').value;
                const rol = document.getElementById('personal-rol').value;
                const sueldo = parseFloat(document.getElementById('personal-sueldo').value) || 0;
                const telefono = document.getElementById('personal-telefono').value;
                const email = document.getElementById('personal-email').value;
                const password = document.getElementById('personal-password').value;
                const fecha_ingreso = document.getElementById('personal-fecha-ingreso').value || new Date().toISOString().split('T')[0];
                const fecha_egreso = document.getElementById('personal-fecha-egreso').value || null;
            
                showToast("Registrando accesos en la nube...");
                
                const { data, error: functionError } = await supabaseClient.functions.invoke('admin-create-user', {
                    body: { 
                        nombre, 
                        rol, 
                        sueldo, 
                        telefono, 
                        email, 
                        password, 
                        fecha_ingreso, 
                        fecha_egreso 
                    }
                });
            
                if (functionError) { 
                    showToast("No fue posible crear el empleado: " + functionError.message, true); 
                    return; 
                }
            
                document.getElementById('new-personal-form').reset(); 
                document.getElementById('personal-fecha-ingreso').value = new Date().toISOString().split('T')[0];
                showToast("Empleado y accesos creados con éxito."); 
                
                if (typeof API_Service !== 'undefined' && API_Service.fetchPersonal) {
                    API_Service.fetchPersonal(true);
                }
            },

            async handleDeletePersonal(id) {
                customConfirm("¿Eliminar empleado?", "Dejará de contabilizar en la nómina.", async () => {
                    const { error } = await supabaseClient.functions.invoke('admin-delete-user', { body: { id: Number(id) } });
                    if (error) { showToast("No fue posible eliminar el empleado: " + error.message, true); return; }
                    API_Service.fetchPersonal(true);
                });
            },

            renderAnticiposModal(ordenId) {
                const tbody = document.getElementById('tbody-anticipos-orden');
                const lblTotal = document.getElementById('lbl-total-anticipos-orden');
                if (!tbody || !lblTotal) return;

                const pagosOrden = State.pagos.filter(p => Number(p.orden_id) === Number(ordenId));
                let totalAcumulado = 0;

                if (pagosOrden.length === 0) {
                    tbody.innerHTML = `<tr><td colspan="3" class="py-2 text-center text-slate-400">Sin anticipos previos registrados.</td></tr>`;
                    lblTotal.innerText = Utils.formatter.format(0);
                    return;
                }

                tbody.innerHTML = pagosOrden.map(p => {
                    const monto = parseFloat(p.monto || 0);
                    totalAcumulado += monto;
                    const fecha = Utils.parseFechaLocal(p.fecha).toLocaleDateString('es-MX', {
                        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
                    });

                    return `
                        <tr>
                            <td class="py-1 font-medium">${fecha}</td>
                            <td class="py-1 font-semibold text-slate-700">${Utils.escapeHtml(p.metodo_pago)} (${Utils.escapeHtml(p.tipo)})</td>
                            <td class="py-1 text-right font-bold text-emerald-600">${Utils.formatter.format(monto)}</td>
                        </tr>
                    `;
                }).join('');

                lblTotal.innerText = Utils.formatter.format(totalAcumulado);
            },

            openEditModal(id) {
                const o = State.orders.find(x => x.id === id); if(!o) return;
                State.currentEditingOrderId = id;
                document.getElementById('modal-order-id').innerText = `#${o.id}`;
                document.getElementById('modal-order-sub').innerText = `${o.auto_marca} - Placas: ${o.auto_placas}`;
                document.getElementById('modal-estado-trabajo').value = o.estado;
                document.getElementById('modal-estado-pago').value = o.estado_pago;
                
                const targetVal = o.tecnico_user_id || (State.personal.find(p => p.nombre === o.tecnico_asignado)?.id || "");
                const mSelEdit = document.getElementById('modal-tecnico');
                mSelEdit.value = targetVal;
                // Si el mecánico ya asignado fue dado de baja, no aparece en las opciones activas.
                // Se agrega temporalmente para no perder ni pisar accidentalmente la asignación existente.
                if (targetVal && mSelEdit.value != targetVal) {
                    const mecBaja = State.personal.find(p => (p.user_id || p.id) == targetVal);
                    const nombreMec = mecBaja ? mecBaja.nombre : (o.tecnico_asignado || 'Mecánico dado de baja');
                    const opt = document.createElement('option');
                    opt.value = targetVal;
                    opt.textContent = `🔧 ${nombreMec} (Baja)`;
                    mSelEdit.appendChild(opt);
                    mSelEdit.value = targetVal;
                }

                document.getElementById('modal-diagnostico').value = o.diagnostico_tecnico || '';
                document.getElementById('modal-kilometraje').value = o.kilometraje || 0;
                document.getElementById('modal-requiere-factura').checked = o.requiere_factura || false;
                
                document.getElementById('modal-fecha-ingreso').value = o.fecha_ingreso ? o.fecha_ingreso.split('T')[0] : '';
                document.getElementById('modal-fecha-egreso').value = o.fecha_egreso ? o.fecha_egreso.split('T')[0] : '';

                State.modalEditingConcepts = o.conceptos ? structuredClone(o.conceptos) : [];
                const mSel = document.getElementById('modal-metodo-pago');
                if(mSel) mSel.value = o.metodo_pago || "Efectivo";

                document.getElementById('modal-monto-abono').value = '';
                Utils.setDefaultFechaPago('modal-fecha-pago');

                document.getElementById('modal-edit-order').classList.remove('hidden');
                this.applyRolePermissions();
                this.toggleModalPaymentMethod();

                this.renderAnticiposModal(id);
                this.cargarRefaccionesModal(id);
                this.cargarPdfsModal(id);
            },

            closeModal() { document.getElementById('modal-edit-order').classList.add('hidden'); },
            
            toggleModalPaymentMethod() {
                const state = document.getElementById('modal-estado-pago').value;
                const container = document.getElementById('modal-payment-method-container');
                if(!container) return;
                if(state === 'Anticipo' || state === 'Pagado') { container.classList.remove('hidden'); } else { container.classList.add('hidden'); }
            },

            addModalConceptRow() { State.modalEditingConcepts.push({ descripcion: '', cantidad: 1, precio: 0, categoria: 'refacciones' }); this.renderModalConcepts(); },
            deleteModalConceptRow(idx) { State.modalEditingConcepts.splice(idx,1); this.renderModalConcepts(); },
            updateModalConceptRow(idx, field, val) {
                if(field=='cantidad') State.modalEditingConcepts[idx].cantidad = parseInt(val)||1;
                else if(field=='precio') State.modalEditingConcepts[idx].precio = parseFloat(val)||0;
                else State.modalEditingConcepts[idx][field] = val;
                this.calculateModalTotals();
            },
            calculateModalTotals() {
                let m=0, r=0; State.modalEditingConcepts.forEach(c=>{ if(c.categoria==='mano-obra') m+=c.cantidad*c.precio; else r+=c.cantidad*c.precio; });
                let subtotal = m + r;
                let requiereFactura = document.getElementById('modal-requiere-factura').checked;
                let iva = requiereFactura ? subtotal * 0.16 : 0;
                let total = subtotal + iva;

                document.getElementById('modal-sum-mano').innerText = Utils.formatter.format(m);
                document.getElementById('modal-sum-ref').innerText = Utils.formatter.format(r);
                document.getElementById('modal-sum-total').innerText = Utils.formatter.format(total);
            },

            renderModalConcepts() {
                const container = document.getElementById('modal-concepts-container'); if(!container) return;
                container.innerHTML = State.modalEditingConcepts.map((item, idx) => {
                    const precioDisplay = (item.precio === 0 || item.precio === '') ? '' : item.precio;
                    return `
                        <div class="flex gap-2 items-center text-xs border p-1.5 rounded bg-white">
                            <input type="text" value="${Utils.escapeHtml(item.descripcion)}" oninput="UI_Controller.updateModalConceptRow(${idx},'descripcion',this.value)" class="flex-1 border p-0.5 focus:outline-none">
                            <select onchange="UI_Controller.updateModalConceptRow(${idx},'categoria',this.value)" class="bg-white border"><option value="refacciones" ${item.categoria==='refacciones'?'selected':''}>Refacc.</option><option value="mano-obra" ${item.categoria==='mano-obra'?'selected':''}>Trabajo</option></select>
                            <input type="number" step="any" value="${Number(item.cantidad) || 0}" oninput="UI_Controller.updateModalConceptRow(${idx},'cantidad',this.value)" class="w-10 text-center border focus:outline-none">
                            <input type="number" step="any" value="${Number(precioDisplay) || ''}" placeholder="0.00" oninput="UI_Controller.updateModalConceptRow(${idx},'precio',this.value)" class="w-16 text-right border focus:outline-none ${State.currentRole==='Mecánico'?'hidden':''}">
                            <button onclick="UI_Controller.deleteModalConceptRow(${idx})" class="text-rose-500"><span class="material-icons text-xs">delete</span></button>
                        </div>`;
                }).join('');
                this.calculateModalTotals();
            },

            async cargarRefaccionesModal(ordenId) {
                this.ordenActivaId = ordenId;
                
                const now = new Date();
                now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
                const inputFecha = document.getElementById('ref-fecha');
                if (inputFecha) inputFecha.value = now.toISOString().slice(0, 16);

                try {
                    const compras = await API_Service.obtenerComprasPorOrden(ordenId);
                    const tbody = document.getElementById('tbody-refacciones-orden');
                    const lblTotal = document.getElementById('lbl-total-refacciones-orden');
                    
                    if (!tbody) return;
                    tbody.innerHTML = '';
                    let totalAcumulado = 0;

                    if (!compras || compras.length === 0) {
                        tbody.innerHTML = `<tr><td colspan="6" class="p-3 text-center text-slate-400">No hay compras registradas para esta orden.</td></tr>`;
                    } else {
                        compras.forEach(item => {
                            totalAcumulado += parseFloat(item.costo_neto || 0);
                            const fechaFormateada = Utils.parseFechaLocal(item.fecha_compra).toLocaleString('es-MX', {
                                day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
                            });
                            const badgeCfdi = item.tiene_cfdi ? '<span class="ml-1 px-1 py-0.2 text-[8px] font-bold bg-blue-100 text-blue-700 rounded">CFDI</span>' : '';

                            tbody.innerHTML += `
                                <tr class="hover:bg-slate-50 transition">
                                    <td class="p-2 text-[10px] text-slate-500 font-medium">${fechaFormateada}</td>
                                    <td class="p-2 font-semibold text-slate-800">${Utils.escapeHtml(item.descripcion)}${badgeCfdi}</td>
                                    <td class="p-2 text-slate-600">${Utils.escapeHtml(item.proveedor || '-')}</td>
                                    <td class="p-2"><span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">${Utils.escapeHtml(item.metodo_pago)}</span></td>
                                    <td class="p-2 text-right font-bold text-slate-800">${Utils.formatter.format(item.costo_neto)}</td>
                                    <td class="p-2 text-center">
                                        <button type="button" onclick="UI_Controller.borrarRefaccionModal(${item.id})" class="text-rose-500 hover:text-rose-700 transition" title="Eliminar">
                                            <span class="material-icons text-sm">delete</span>
                                        </button>
                                    </td>
                                </tr>
                            `;
                        });
                    }

                    if (lblTotal) lblTotal.innerText = Utils.formatter.format(totalAcumulado);
                } catch (err) {
                    console.error("Error al cargar refacciones:", err);
                    showToast("Error al cargar el historial de refacciones", true);
                }
            },

            async guardarRefaccionModal(event) {
                event.preventDefault();

                if (!this.ordenActivaId) return;

                const desc = document.getElementById('ref-descripcion').value.trim();
                const costoTotal = parseFloat(document.getElementById('ref-costo').value) || 0;
                const tieneCfdi = document.getElementById('ref-tiene-cfdi').checked;

                const ivaCalculado = tieneCfdi ? Math.round((costoTotal - (costoTotal / 1.08)) * 100) / 100 : 0;
                const subtotalCalculado = costoTotal - ivaCalculado;
                const fechaInput = document.getElementById('ref-fecha').value;
                const fechaISO = fechaInput ? new Date(fechaInput).toISOString() : new Date().toISOString();

                const datosCompra = {
                    orden_id: this.ordenActivaId,
                    descripcion: desc,
                    proveedor: document.getElementById('ref-proveedor').value.trim() || null,
                    costo_neto: costoTotal,
                    subtotal: subtotalCalculado,
                    iva: ivaCalculado,
                    total_pagado: costoTotal,
                    tiene_cfdi: tieneCfdi,
                    iva_acreditable: tieneCfdi,
                    metodo_pago: document.getElementById('ref-metodo').value,
                    folio_ticket_factura: document.getElementById('ref-folio').value.trim() || null,
                    fecha_compra: fechaISO,
                    fecha_pago: fechaISO
                };

                try {
                    await API_Service.registrarCompraRefaccion(datosCompra);
                    showToast("Refacción registrada correctamente");

                    State.modalEditingConcepts.push({
                        descripcion: desc,
                        cantidad: 1,
                        precio: costoTotal,
                        categoria: 'refacciones'
                    });

                    this.renderModalConcepts();

                    document.getElementById('form-agregar-refaccion').reset();
                    await this.cargarRefaccionesModal(this.ordenActivaId);
                    
                    API_Service.fetchOrders(true);
                } catch (err) {
                    console.error("Error al guardar refacción:", err);
                    showToast("No se pudo registrar la compra: " + err.message, true);
                }
            },

            async borrarRefaccionModal(compraId) {
                customConfirm("¿Eliminar refacción?", "El costo total de la compra se actualizará automáticamente.", async () => {
                    try {
                        await API_Service.eliminarCompraRefaccion(compraId);
                        showToast("Compra eliminada");
                        await UI_Controller.cargarRefaccionesModal(UI_Controller.ordenActivaId);
                        API_Service.fetchOrders(true);
                    } catch (err) {
                        console.error("Error al eliminar refacción:", err);
                        showToast("Error al intentar borrar la compra", true);
                    }
                });
            },

            // --- VISTAS Y LOGICA PARA ARCHIVOS PDF DE GASTOS ---
            async cargarPdfsModal(ordenId) {
                const tbody = document.getElementById('tbody-pdf-gastos');
                if (!tbody) return;
            
                try {
                    const documentos = await API_Service.obtenerPdfsPorOrden(ordenId);
                    tbody.innerHTML = '';
            
                    if (!documentos || documentos.length === 0) {
                        tbody.innerHTML = `<tr><td colspan="3" class="p-3 text-center text-slate-400">Sin comprobantes adjuntos.</td></tr>`;
                    } else {
                        documentos.forEach(doc => {
                            const fStr = Utils.parseFechaLocal(doc.created_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
            
                            tbody.innerHTML += `
                                <tr class="hover:bg-slate-50 transition">
                                    <td class="p-2 text-[10px] text-slate-500 font-medium">${fStr}</td>
                                    <td class="p-2 font-semibold text-slate-800">${Utils.escapeHtml(doc.nombre_archivo)}</td>
                                    <td class="p-2 text-center flex items-center justify-center gap-2">
                                        <a href="${doc.archivo_url}" target="_blank" class="text-blue-600 hover:text-blue-800" title="Ver PDF">
                                            <span class="material-icons text-sm">visibility</span>
                                        </a>
                                        <button type="button" onclick="UI_Controller.borrarPdfGasto(${doc.id})" class="text-rose-500 hover:text-rose-700" title="Eliminar">
                                            <span class="material-icons text-sm">delete</span>
                                        </button>
                                    </td>
                                </tr>
                            `;
                        });
                    }
                } catch (err) {
                    showToast("Error al obtener los comprobantes PDF", true);
                }
            },

            async subirPdfGasto() {
                const input = document.getElementById('pdf-gasto-input');
                const file = input.files[0];
            
                if (!file) {
                    showToast("Selecciona un archivo PDF primero", true);
                    return;
                }
            
                showToast("Subiendo nota de gasto...");
            
                try {
                    await API_Service.subirArchivoPdf(State.currentEditingOrderId, file, 0);
                    showToast("Comprobante subido correctamente");
                    
                    input.value = '';
                    await this.cargarPdfsModal(State.currentEditingOrderId);
                } catch (err) {
                    showToast("Error al subir el archivo: " + err.message, true);
                }
            },
            async borrarPdfGasto(id) {
                customConfirm("¿Eliminar comprobante?", "Esta acción eliminará el registro de la nota de gasto.", async () => {
                    try {
                        await API_Service.eliminarPdfGasto(id);
                        showToast("Comprobante eliminado");
                        await UI_Controller.cargarPdfsModal(State.currentEditingOrderId);
                    } catch (err) {
                        showToast("No se pudo eliminar el archivo", true);
                    }
                });
            },

            async handleSaveChanges() {
                const modalManualDate = document.getElementById('modal-fecha-ingreso').value;
                const modalEgresoDate = document.getElementById('modal-fecha-egreso').value;

                const targetUserVal = document.getElementById('modal-tecnico').value || null;
                const mecObj = State.personal.find(p => (p.user_id && p.user_id === targetUserVal) || p.id == targetUserVal);

                const ordenActual = (State.orders || []).find(o => Number(o.id) === Number(State.currentEditingOrderId));

                let fields = {
                    estado: document.getElementById('modal-estado-trabajo').value,
                    diagnostico_tecnico: document.getElementById('modal-diagnostico').value,
                    kilometraje: parseInt(document.getElementById('modal-kilometraje').value) || 0,
                    fecha_ingreso: modalManualDate ? Utils.parseFechaLocal(modalManualDate).toISOString() : new Date().toISOString(),
                    fecha_egreso: modalEgresoDate ? Utils.parseFechaLocal(modalEgresoDate).toISOString() : null,
                    tecnico_user_id: mecObj ? (mecObj.user_id || null) : null,
                    tecnico_asignado: mecObj ? mecObj.nombre : 'Sin Asignar',
                    facturado: ordenActual ? (ordenActual.facturado || false) : false
                };
                
                let montoAbonoIngresado = 0;

                if (State.currentRole !== 'Mecánico') {
                    let paymentState = document.getElementById('modal-estado-pago').value;
                    const requiereFactura = document.getElementById('modal-requiere-factura').checked;

                    let m = 0, r = 0; 
                    State.modalEditingConcepts.forEach(c => { 
                        if (c.categoria === 'mano-obra') m += c.cantidad * c.precio; 
                        else r += c.categoria === 'refacciones' ? c.cantidad * c.precio : 0; 
                    });
                    let subtotal = m + r;
                    let ivaCalculado = requiereFactura ? subtotal * 0.16 : 0;
                    let granTotal = subtotal + ivaCalculado;

                    montoAbonoIngresado = parseFloat(document.getElementById('modal-monto-abono').value) || 0;

                    fields.estado_pago = paymentState;
                    fields.metodo_pago = (paymentState === 'Anticipo' || paymentState === 'Pagado') ? (document.getElementById('modal-metodo-pago').value || 'Efectivo') : '';
                    fields.requiere_factura = requiereFactura;
                    fields.total_iva = ivaCalculado;
                    
                    if (State.currentRole === 'Administrador') { 
                        fields.costo_mano_obra = m; 
                        fields.costo_refacciones = r; 
                        fields.total_cobrado = granTotal; 
                        fields.conceptos = JSON.stringify(State.modalEditingConcepts);
                    }
                }

                const { error } = await supabaseClient.from('ordenes_trabajo').update(fields).eq('id', State.currentEditingOrderId); 
                if (error) { showToast("Error al guardar: " + error.message, true); return; }

                let errorPago = null;
                if (montoAbonoIngresado > 0) {
                    const fechaPagoInput = document.getElementById('modal-fecha-pago').value;
                    const fechaPago = fechaPagoInput ? new Date(fechaPagoInput).toISOString() : new Date().toISOString();

                    const nuevoPagoObj = {
                        orden_id: State.currentEditingOrderId,
                        monto: montoAbonoIngresado,
                        metodo_pago: fields.metodo_pago || 'Efectivo',
                        tipo: fields.estado_pago === 'Anticipo' ? 'anticipo' : 'pago_final',
                        fecha: fechaPago,
                        observaciones: 'Pago registrado desde el modal de orden'
                    };

                    const insertResult = await supabaseClient.from('pagos').insert([nuevoPagoObj]);
                    errorPago = insertResult.error;
                }

                if (errorPago) {
                    showToast("Cambios guardados, pero el pago no se pudo registrar: " + errorPago.message, true);
                } else {
                    showToast("Cambios guardados con éxito.");
                }
                this.closeModal(); 

                await API_Service.fetchOrders(true);
                await API_Service.fetchPagos(true);
                await Financial_Engine.recalculate();
            },

            async handleDeleteOrder() {
                customConfirm("¿Cancelar orden?", "La orden cambiará a estado Cancelada para preservar trazabilidad.", async () => {
                    const { error } = await supabaseClient
                        .from('ordenes_trabajo')
                        .update({ estado: 'Cancelada' })
                        .eq('id', State.currentEditingOrderId); 
                    if (error) { showToast("Error al cancelar orden: " + error.message, true); return; }
                    showToast("Orden marcada como Cancelada.");
                    UI_Controller.closeModal(); API_Service.fetchOrders(true);
                });
            },

            loadOrderIntoQuote() {
                const id = document.getElementById('quote-order-loader').value; if(!id) return;
                const o = State.orders.find(x => x.id == id); if(!o) return;
                document.getElementById('quote-cliente').value = o.cliente_nombre;
                document.getElementById('quote-telefono').value = o.cliente_telefono || '';
                document.getElementById('quote-auto').value = `${o.auto_marca} ${o.auto_modelo}`;
                document.getElementById('quote-placas').value = o.auto_placas;
                
                const docType = document.getElementById('quote-doc-type').value;
                document.getElementById('pdf-doc-id').innerText = docType === 'NOTA DE VENTA' ? `FOLIO: #NOTA-${o.id}` : `FOLIO: #COT-${o.id}`;
                
                document.getElementById('pdf-km-view').innerText = `| KM: ${o.kilometraje || 0}`;
                
                State.quoteItems = o.conceptos ? structuredClone(o.conceptos) : [];
                document.getElementById('quote-discount').value = 0;
                document.getElementById('quote-tax').value = o.requiere_factura ? 16 : 0; 
                this.renderQuoteBuilderItems();
            },

            addQuoteItem() { 
                State.quoteItems.push({ descripcion: '', cantidad: 1, precio: 0, categoria: 'refacciones' }); 
                this.renderQuoteBuilderItems(); 
            },

            updateQuoteItemData(idx, field, val) {
                if (!State.quoteItems[idx]) return;
                if (field === 'cantidad') {
                    State.quoteItems[idx].cantidad = parseInt(val) || 0;
                } else if (field === 'precio') {
                    State.quoteItems[idx].precio = parseFloat(val) || 0;
                } else {
                    State.quoteItems[idx][field] = val;
                }
                this.updateQuotePreview();
            },

            deleteQuoteItem(idx) {
                State.quoteItems.splice(idx, 1);
                this.renderQuoteBuilderItems();
            },

            renderQuoteBuilderItems() {
                const container = document.getElementById('quote-items-container'); if(!container) return;
                container.innerHTML = State.quoteItems.map((item, idx) => `
                    <div class="flex gap-2 border p-1 rounded bg-slate-50 text-xs">
                        <input type="text" value="${Utils.escapeHtml(item.descripcion)}" oninput="UI_Controller.updateQuoteItemData(${idx},'descripcion',this.value)" class="flex-1 p-0.5 border focus:outline-none" placeholder="Concepto">
                        <select onchange="UI_Controller.updateQuoteItemData(${idx},'categoria',this.value)" class="bg-white border text-[10px] rounded">
                            <option value="refacciones" ${item.categoria==='refacciones'?'selected':''}>Refacc</option>
                            <option value="mano-obra" ${item.categoria==='mano-obra'?'selected':''}>Trabajo</option>
                        </select>
                        <input type="number" value="${Number(item.cantidad) || 0}" oninput="UI_Controller.updateQuoteItemData(${idx},'cantidad',this.value)" class="w-10 text-center border focus:outline-none">
                        <input type="number" step="any" value="${Number(item.precio) || 0}" oninput="UI_Controller.updateQuoteItemData(${idx},'precio',this.value)" class="w-16 text-right border focus:outline-none">
                        <button type="button" onclick="UI_Controller.deleteQuoteItem(${idx})" class="text-rose-500"><span class="material-icons text-xs">delete</span></button>
                    </div>`).join('');
                this.updateQuotePreview();
            },

            updateQuotePreview() {
                const docType = document.getElementById('quote-doc-type').value;
                document.getElementById('pdf-doc-title').innerText = docType;

                const validityContainer = document.getElementById('quote-validity-container');
                const validityText = document.getElementById('pdf-validity-view');
                const orderLoader = document.getElementById('quote-order-loader').value;

                if (docType === 'NOTA DE VENTA') {
                    if(validityContainer) validityContainer.classList.add('hidden');
                    if(validityText) validityText.classList.add('hidden');
                    document.getElementById('pdf-doc-id').innerText = orderLoader ? `FOLIO: #NOTA-${orderLoader}` : 'FOLIO: #NOTA-000';
                    document.getElementById('pdf-total-label').innerText = 'TOTAL A PAGAR:';
                } else {
                    if(validityContainer) validityContainer.classList.remove('hidden');
                    if(validityText) validityText.classList.remove('hidden');
                    document.getElementById('pdf-doc-id').innerText = orderLoader ? `FOLIO: #COT-${orderLoader}` : 'FOLIO: #COT-000';
                    document.getElementById('pdf-total-label').innerText = 'TOTAL ESTIMADO:';
                }

                document.getElementById('pdf-client-name').innerText = document.getElementById('quote-cliente').value || 'Público General';
                document.getElementById('pdf-client-phone').innerText = `Tel: ${document.getElementById('quote-telefono').value || '-'}`;
                document.getElementById('pdf-vehicle').innerText = document.getElementById('quote-auto').value || 'Vehículo';
                document.getElementById('pdf-plates').innerText = document.getElementById('quote-placas').value.toUpperCase() || 'S/P';

                const tbody = document.getElementById('pdf-concepts-body'); if(!tbody) return;
                let subtotal = 0;
                
                tbody.innerHTML = State.quoteItems.map(item => {
                    const imp = item.cantidad * item.precio; 
                    subtotal += imp;
                    return `
                        <tr class="border-b">
                            <td class="py-2 px-4 font-bold">${Utils.escapeHtml(item.descripcion || 'Sin descripción')}</td>
                            <td class="text-center text-[10px]">${item.categoria === 'mano-obra' ? 'Trabajo' : 'Refacc'}</td>
                            <td class="text-center">${Number(item.cantidad) || 0}</td>
                            <td class="text-right">${Utils.formatter.format(Number(item.precio) || 0)}</td>
                            <td class="text-right font-bold">${Utils.formatter.format(imp)}</td>
                        </tr>`;
                }).join('');

                const desc = parseFloat(document.getElementById('quote-discount').value) || 0;
                const tax = parseFloat(document.getElementById('quote-tax').value) || 0;
                
                const descuentoMonto = subtotal * (desc / 100);
                const subtotalConDescuento = subtotal - descuentoMonto;
                const ivaMonto = subtotalConDescuento * (tax / 100);
                const finalTotal = subtotalConDescuento + ivaMonto;

                document.getElementById('pdf-subtotal').innerText = Utils.formatter.format(subtotal);
                document.getElementById('pdf-discount').innerText = Utils.formatter.format(descuentoMonto);
                document.getElementById('pdf-tax').innerText = Utils.formatter.format(ivaMonto);
                document.getElementById('pdf-total').innerText = Utils.formatter.format(finalTotal);
                
                const valdays = document.getElementById('quote-validity').value || 15;
                if(docType !== 'NOTA DE VENTA') {
                    document.getElementById('pdf-validity-view').innerText = `Válido por ${valdays} días hábiles.`;
                }
            },

            clearQuoteForm() {
                document.getElementById('quote-cliente').value = '';
                document.getElementById('quote-telefono').value = '';
                document.getElementById('quote-auto').value = '';
                document.getElementById('quote-placas').value = '';
                document.getElementById('quote-order-loader').value = '';
                State.quoteItems = [];
                this.renderQuoteBuilderItems();
            },

            downloadQuotePDF() {
                const docType = document.getElementById('quote-doc-type').value;
                const orderLoader = document.getElementById('quote-order-loader').value;
                const tipoArchivo = docType === 'NOTA DE VENTA' ? 'Nota_de_Venta' : 'Cotizacion';

                let filename;
                if (orderLoader) {
                    filename = `${tipoArchivo}_Orden_${orderLoader}_BEFIX_GARAGE.pdf`;
                } else {
                    const hoy = new Date().toISOString().split('T')[0];
                    filename = `${tipoArchivo}_BEFIX_GARAGE_${hoy}.pdf`;
                }

                showToast("Generando archivo PDF...");
                html2pdf().set({ margin: 0.2, filename: filename, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2 }, jsPDF: { format: 'letter', orientation: 'portrait' } })
                    .from(document.getElementById('pdf-capture-area')).save();
            },

            loadFixedCosts() {
                if(document.getElementById('fixed-renta')) document.getElementById('fixed-renta').value = State.fixedCosts.renta || 0;
                if(document.getElementById('fixed-servicios')) document.getElementById('fixed-servicios').value = State.fixedCosts.servicios || 0;
                if(document.getElementById('fixed-impuestos')) document.getElementById('fixed-impuestos').value = State.fixedCosts.impuestos || 0;
            },

            saveFixedCosts() {
                State.fixedCosts.renta = parseFloat(document.getElementById('fixed-renta').value) || 0;
                State.fixedCosts.servicios = parseFloat(document.getElementById('fixed-servicios').value) || 0;
                State.fixedCosts.impuestos = parseFloat(document.getElementById('fixed-impuestos').value) || 0;
                debouncedSaveFixedCosts();
                Financial_Engine.recalculate();
            },

            loadSociosReparto() {
                if (!State.sociosReparto || State.sociosReparto.length === 0) {
                    State.sociosReparto = [
                        { nombre: 'Socio 1', porcentaje: 50 },
                        { nombre: 'Socio 2', porcentaje: 50 }
                    ];
                }
                this.renderSociosReparto();
            },

            renderSociosReparto() {
                const cont = document.getElementById('socios-reparto-list');
                if (!cont) return;
                cont.innerHTML = State.sociosReparto.map((s, idx) => `
                    <div class="flex items-center gap-3">
                        <input type="text" value="${Utils.escapeHtml(s.nombre)}" oninput="UI_Controller.updateSocioField(${idx}, 'nombre', this.value)" placeholder="Nombre del socio" class="flex-1 border rounded-xl px-3 py-2 text-sm focus:outline-none">
                        <div class="flex items-center gap-1.5 w-28">
                            <input type="number" min="0" max="100" step="0.1" value="${s.porcentaje}" oninput="UI_Controller.updateSocioField(${idx}, 'porcentaje', this.value)" class="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none">
                            <span class="text-slate-400 text-sm font-bold">%</span>
                        </div>
                        <button type="button" onclick="UI_Controller.removeSocioRow(${idx})" class="text-rose-400 hover:text-rose-600">
                            <span class="material-icons text-lg">delete</span>
                        </button>
                    </div>
                `).join('');
                this.updateSociosTotalBadge();
            },

            updateSociosTotalBadge() {
                const badge = document.getElementById('socios-reparto-total');
                if (!badge) return;
                const total = State.sociosReparto.reduce((acc, s) => acc + (parseFloat(s.porcentaje) || 0), 0);
                const totalRedondeado = Math.round(total * 10) / 10;
                if (totalRedondeado === 100) {
                    badge.className = 'text-xs font-bold px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700';
                    badge.textContent = `✓ Total: ${totalRedondeado}%`;
                } else {
                    badge.className = 'text-xs font-bold px-3 py-1.5 rounded-full bg-amber-50 text-amber-700';
                    badge.textContent = `⚠️ Total: ${totalRedondeado}% (debe sumar 100%)`;
                }
            },

            updateSocioField(idx, field, value) {
                if (!State.sociosReparto[idx]) return;
                State.sociosReparto[idx][field] = field === 'porcentaje' ? (parseFloat(value) || 0) : value;
                debouncedSaveSociosReparto();
                this.updateSociosTotalBadge();
            },

            addSocioRow() {
                State.sociosReparto.push({ nombre: `Socio ${State.sociosReparto.length + 1}`, porcentaje: 0 });
                API_Service.saveConfigValue('socios_reparto', State.sociosReparto);
                this.renderSociosReparto();
            },

            removeSocioRow(idx) {
                State.sociosReparto.splice(idx, 1);
                API_Service.saveConfigValue('socios_reparto', State.sociosReparto);
                this.renderSociosReparto();
            },

            async runSelfTest() {
                const cont = document.getElementById('selftest-results');
                if (cont) {
                    cont.classList.remove('hidden');
                    cont.innerHTML = `<p class="text-xs text-slate-400 flex items-center gap-2"><span class="material-icons text-sm animate-spin">progress_activity</span> Ejecutando pruebas...</p>`;
                }

                const results = await Financial_Engine.runSelfTest();
                const okCount = results.filter(r => r.ok).length;
                const total = results.length;

                if (cont) {
                    const rows = results.map(r => `
                        <div class="flex items-center justify-between text-xs px-3 py-2 rounded-lg ${r.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}">
                            <span class="flex items-center gap-1.5 font-medium">
                                <span class="material-icons text-sm">${r.ok ? 'check_circle' : 'cancel'}</span>
                                ${Utils.escapeHtml(r.label)}
                            </span>
                            ${(!r.ok && r.expected !== null) ? `<span class="font-mono font-bold text-right">esperado: ${Utils.formatter.format(r.expected)} — obtuvo: ${Utils.formatter.format(r.actual || 0)}</span>` : ''}
                        </div>
                    `).join('');

                    cont.innerHTML = `
                        <div class="flex items-center justify-between mb-1 p-3 rounded-xl ${okCount === total ? 'bg-emerald-100 text-emerald-900' : 'bg-rose-100 text-rose-900'} font-bold text-sm">
                            <span>${okCount === total ? '✅ Todas las pruebas pasaron' : '⚠️ Hay pruebas fallando — revisa antes de confiar en el reporte'}</span>
                            <span>${okCount} / ${total}</span>
                        </div>
                        ${rows}
                    `;
                }

                if (okCount === total) {
                    showToast(`Auto-diagnóstico OK: ${okCount}/${total} pruebas pasaron.`);
                } else {
                    showToast(`⚠️ Auto-diagnóstico encontró ${total - okCount} problema(s). Revisa Ajustes.`, true);
                }
            },
            toggleFacturado: async function(orderId, nuevoEstado) {
                try {
                    // 1. Actualización inmediata en la memoria del ERP
                    const order = (State.orders || []).find(o => Number(o.id) === Number(orderId));
                    if (order) {
                        order.facturado = nuevoEstado;
                    }

                    // 2. Refrescar la tabla en pantalla al instante
                    UI_Controller.renderOrdersList();

                    // 3. Guardar el cambio en Supabase
                    const { error } = await supabaseClient
                        .from('ordenes_trabajo')
                        .update({ facturado: nuevoEstado })
                        .eq('id', Number(orderId));

                    if (error) throw error;

                    const mensaje = nuevoEstado ? 'Orden marcada como Facturada' : 'Orden marcada como Pendiente de Factura';
                    if (typeof showToast === 'function') showToast(mensaje);

                } catch (err) {
                    console.error("Error al actualizar estado de facturación:", err);
                    if (typeof showToast === 'function') showToast("No se pudo actualizar el estado de la factura", true);
                }
            },
            
            closeConfirmModal(result) {
                document.getElementById('modal-confirm').classList.add('hidden');
                if (result && typeof State.confirmCallback === 'function') State.confirmCallback();
                State.confirmCallback = null;
            }
        };
