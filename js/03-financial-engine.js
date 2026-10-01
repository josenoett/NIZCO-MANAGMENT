        const Financial_Engine = {
            CATEGORIAS_NO_OPERATIVAS: ["Pago de Préstamos / Socios", "Traspaso entre Cuentas (Caja/Banco)"],
            CATEGORIA_REPARTO: "Reparto de Utilidades (Retiro de Socios)",
            // Gastos fijos que ya entran a la Utilidad por PRORRATEO (Ajustes → Gastos Estructurales).
            // Su pago real en Tesorería solo saca dinero de caja/banco; si se restara también de la
            // Utilidad, contaría dos veces. Si el prorrateo de ese rubro está en $0, el pago se trata
            // como gasto operativo normal (como antes) para no dejar de contarlo.
            CATEGORIAS_FIJAS: { "Renta": "renta", "Agua": "servicios", "Luz": "servicios", "Internet": "servicios", "Impuestos": "impuestos" },

            // Clasificación única de un gasto de Tesorería (la usan Utilidad, Corte y saldos)
            clasificarGasto(e) {
                const m = parseFloat(e.monto || 0);
                if (e.categoria === 'Nómina') return m < 0 ? 'deduccion_nomina' : 'nomina';
                if (e.categoria === this.CATEGORIA_REPARTO) return 'reparto';
                if (this.CATEGORIAS_NO_OPERATIVAS.includes(e.categoria)) return 'no_operativo';
                const rubro = this.CATEGORIAS_FIJAS[e.categoria];
                if (rubro && (parseFloat((State.fixedCosts || {})[rubro]) || 0) > 0) return 'fijo';
                return 'operativo';
            },

            // Cuenta afectada por un método de pago: 'efectivo' | 'banco' | null (p.ej. crédito de proveedor)
            cuentaDe(metodo, entrada = false) {
                const m = (metodo || '').trim().toLowerCase();
                if (m === 'efectivo') return 'efectivo';
                if (entrada) return 'banco'; // cobros/ingresos: todo lo que no es efectivo cae al banco (igual que antes)
                if (m === 'transferencia' || m === 'tarjeta') return 'banco';
                return null;
            },

            getDateRange(preset, customStartId = 'erp-start-date', customEndId = 'erp-end-date') {
                const now = new Date();
                let start, end;

                switch(preset) {
                    case 'today':
                        start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
                        end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
                        break;
                    case 'this-week':
                        const currentDay = now.getDay();
                        const distanceToMonday = currentDay === 0 ? -6 : 1 - currentDay;
                        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + distanceToMonday, 0, 0, 0, 0);
                        end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
                        break;
                    case 'this-month':
                        start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
                        end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
                        break;
                    case 'last-month':
                        start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
                        end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
                        break;
                    case 'this-year':
                        start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
                        end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
                        break;
                    case 'custom':
                        const sInput = document.getElementById(customStartId) ? document.getElementById(customStartId).value : '';
                        const eInput = document.getElementById(customEndId) ? document.getElementById(customEndId).value : '';
                        // Desde las 00:00 del primer día (antes era mediodía y se perdían los cobros de la mañana)
                        start = sInput ? new Date(sInput + 'T00:00:00') : new Date(0);
                        end = eInput ? new Date(eInput + 'T23:59:59.999') : new Date();
                        break;
                    default:
                        start = new Date(0);
                        end = new Date();
                }
                return { start, end };
            },

            handlePresetChange() {
                const preset = document.getElementById('erp-date-preset').value;
                const customDiv = document.getElementById('erp-custom-dates');
                if (preset === 'custom') {
                    customDiv.classList.remove('hidden');
                } else {
                    customDiv.classList.add('hidden');
                    this.recalculate();
                }
            },

            // ================================================================================
            // NÚCLEO ÚNICO DE CÁLCULO FINANCIERO
            // Usado tanto por el Dashboard (recalculate) como por el PDF de Corte de Caja
            // (downloadCorteCajaPDF). Antes existían dos copias casi idénticas de esta lógica
            // que podían desviarse entre sí sin que nadie lo notara. Ahora hay un solo lugar
            // que calcula la Utilidad Neta, el IVA, la nómina, etc. — si se corrige o cambia
            // una regla de negocio, se corrige para los dos consumidores a la vez.
            // ================================================================================
            async computeCoreFinancials(start, end) {
                const totalDays = Utils.getDaysInRange(start, end);
                const CATEGORIAS_NO_OPERATIVAS = this.CATEGORIAS_NO_OPERATIVAS;

                // ---------- Órdenes / vehículos atendidos + acumuladores para gráficas ----------
                let vehiculosAtendidos = 0;
                let acumuladoManoObraOrdenes = 0;
                let acumuladoRefaccionesOrdenes = 0;
                let conteoServicios = {};

                State.orders.forEach(o => {
                    if (o.estado === 'Cancelada') return;
                    const oDate = Utils.parseFechaLocal(o.fecha_ingreso || o.fecha_registro);
                    if (oDate >= start && oDate <= end) {
                        vehiculosAtendidos++;
                        acumuladoManoObraOrdenes += parseFloat(o.costo_mano_obra || 0);
                        acumuladoRefaccionesOrdenes += parseFloat(o.costo_refacciones || 0);

                        if (Array.isArray(o.conceptos)) {
                            o.conceptos.forEach(c => {
                                const desc = (c.descripcion || '').trim();
                                if (desc) {
                                    const cant = parseInt(c.cantidad) || 1;
                                    conteoServicios[desc] = (conteoServicios[desc] || 0) + cant;
                                }
                            });
                        }
                    }
                });

                // ---------- Pagos de clientes (ingresos operativos) ----------
                let ingresos = 0, pagado = 0, anticipo = 0, totalIva16Cobrado = 0;
                let entradasEfectivo = 0, entradasBanco = 0;
                let listaOrdenesIngreso = [];
                const pagosProcesadosIds = new Set();
                const ingresosPeriodo = [];

                State.pagos.forEach(p => {
                    if (p.id && pagosProcesadosIds.has(p.id)) return;
                    if (p.id) pagosProcesadosIds.add(p.id);

                    const pDate = Utils.parseFechaLocal(p.fecha);
                    if (pDate >= start && pDate <= end) {
                        const pMonto = Math.round(parseFloat(p.monto || 0) * 100) / 100;
                        ingresos += pMonto;
                        ingresosPeriodo.push(p);

                        const metodo = (p.metodo_pago || '').trim().toLowerCase();
                        if (metodo === 'efectivo') entradasEfectivo += pMonto;
                        else entradasBanco += pMonto;

                        if (p.tipo === 'anticipo') anticipo += pMonto;
                        else pagado += pMonto;

                        const ordenAsociada = State.orders.find(o => o.id === p.orden_id);
                        if (ordenAsociada && ordenAsociada.requiere_factura) {
                            totalIva16Cobrado += (pMonto - (pMonto / 1.16));
                        }

                        listaOrdenesIngreso.push({
                            id: p.id,
                            ordenId: p.orden_id,
                            cliente: ordenAsociada ? ordenAsociada.cliente_nombre : 'Cliente Desconocido',
                            auto: ordenAsociada ? `${ordenAsociada.auto_marca} (${ordenAsociada.auto_placas})` : 'S/I',
                            monto: pMonto,
                            tipo: p.tipo,
                            metodo: p.metodo_pago,
                            fecha: pDate
                        });
                    }
                });

                // ---------- Compras de refacciones (UNA sola consulta a Supabase para todo) ----------
                let refaccionesCostBruto = 0, refaccionesCostNeto = 0, totalIvaAcreditablePagado = 0;
                // Para el puente Utilidad → Flujo de Caja
                let ivaRefaccionesCfdi = 0, comprasSinSalidaDinero = 0, refaccionesOrdenesSinCompra = 0;
                let listaComprasRefacciones = [];
                let refaccionesPeriodo = [];
                let comprasPorProveedor = {};
                let ordenesConComprasSet = new Set();
                let salidasEfectivo = 0, salidasBanco = 0;

                if (supabaseClient) {
                    try {
                        const { data: comprasRango } = await supabaseClient
                            .from('compras_refacciones')
                            .select('id, descripcion, proveedor, costo_neto, total_pagado, iva, tiene_cfdi, metodo_pago, fecha_compra, orden_id')
                            .gte('fecha_compra', start.toISOString())
                            .lte('fecha_compra', end.toISOString())
                            .order('fecha_compra', { ascending: false });

                        refaccionesPeriodo = comprasRango || [];

                        refaccionesPeriodo.forEach(c => {
                            const montoTotalConIva = Math.round(parseFloat(c.costo_neto || c.total_pagado || 0) * 100) / 100;
                            const tieneCfdi = c.tiene_cfdi === true;

                            let subtotalSinIva = montoTotalConIva;
                            let ivaMonto = 0;
                            if (tieneCfdi && montoTotalConIva > 0) {
                                // Desglosa el 8% de IVA incluido (Zona Fronteriza: / 1.08)
                                subtotalSinIva = Math.round((montoTotalConIva / 1.08) * 100) / 100;
                                ivaMonto = Math.round((montoTotalConIva - subtotalSinIva) * 100) / 100;
                            }

                            if (c.orden_id) ordenesConComprasSet.add(Number(c.orden_id));

                            refaccionesCostBruto += montoTotalConIva;
                            refaccionesCostNeto += subtotalSinIva;
                            if (tieneCfdi) { totalIvaAcreditablePagado += ivaMonto; ivaRefaccionesCfdi += ivaMonto; }
                            if (this.cuentaDe(c.metodo_pago) === null) comprasSinSalidaDinero += montoTotalConIva;

                            const metodo = (c.metodo_pago || '').trim().toLowerCase();
                            if (metodo === 'efectivo') salidasEfectivo += montoTotalConIva;
                            else if (metodo === 'transferencia' || metodo === 'tarjeta') salidasBanco += montoTotalConIva;

                            const prov = c.proveedor || 'Otros / Mostrador';
                            comprasPorProveedor[prov] = (comprasPorProveedor[prov] || 0) + montoTotalConIva;

                            const ordenAsociada = State.orders.find(o => Number(o.id) === Number(c.orden_id));
                            listaComprasRefacciones.push({
                                id: c.id,
                                ordenId: c.orden_id ? `#${c.orden_id}` : 'Gasto General',
                                cliente: ordenAsociada ? `${ordenAsociada.cliente_nombre} (${ordenAsociada.auto_marca})` : 'S/I',
                                descripcion: c.descripcion,
                                proveedor: c.proveedor || 'No especificado',
                                metodo: c.metodo_pago,
                                costo: montoTotalConIva,
                                fecha: Utils.parseFechaLocal(c.fecha_compra)
                            });
                        });
                    } catch (e) {
                        console.error("Error al obtener compras de refacciones:", e);
                    }
                }

                // Órdenes con refacciones capturadas directo en la orden (sin registro en compras_refacciones)
                State.orders.forEach(o => {
                    if (o.estado === 'Cancelada') return;
                    const oDate = Utils.parseFechaLocal(o.fecha_ingreso || o.fecha_registro);
                    if (oDate >= start && oDate <= end) {
                        if (!ordenesConComprasSet.has(Number(o.id))) {
                            const costoRefOrden = parseFloat(o.costo_refacciones || 0);
                            if (costoRefOrden > 0) {
                                refaccionesCostBruto += costoRefOrden;
                                refaccionesCostNeto += costoRefOrden;
                                refaccionesOrdenesSinCompra += costoRefOrden;
                            }
                        }
                    }
                });

                // ---------- Gastos de Tesorería (operativos + no operativos) ----------
                let egresosManuales = 0;
                let deduccionesNomina = 0;
                let salidasNoOperativas = 0;
                let entradasNoOperativas = 0;
                let nominaPagadaPeriodo = 0;
                const desgloseNominaPagada = [];
                let repartoPeriodo = 0;
                const desgloseReparto = [];
                let gastosFijosPagados = 0;
                const fijosPagadosPorCategoria = {};
                let montosPorCategoria = {};
                State.categories.forEach(cat => montosPorCategoria[cat] = 0);
                const gastosPorCategoriaPDF = {};
                const desgloseMovimientosNoOperativos = [];

                const gastosPeriodo = State.expenses.filter(e => {
                    const eDate = Utils.parseFechaLocal(e.fecha);
                    return eDate >= start && eDate <= end;
                });

                gastosPeriodo.forEach(e => {
                    const mAmt = Math.round(parseFloat(e.monto || 0) * 100) / 100;
                    const metodo = (e.metodo_pago || '').trim().toLowerCase();

                    // --- CÁLCULO DE IVA ACREDITABLE (8% DESGLOSADO DE GASTOS CON CFDI) ---
                    if (e.tiene_cfdi && mAmt > 0) {
                        const subtotalSinIva = mAmt / 1.08;
                        totalIvaAcreditablePagado += (mAmt - subtotalSinIva);
                    }

                    if (e.categoria === "Nómina" && mAmt < 0) {
                        deduccionesNomina += Math.abs(mAmt);
                    } else if (e.categoria === "Nómina") {
                        // PAGO de nómina (depósito o efectivo entregado). Es dinero que sale de caja/banco,
                        // pero NO se resta otra vez de la Utilidad: el costo de nómina ya entra por lo
                        // devengado según el sueldo de cada colaborador (Nómina y Personal).
                        nominaPagadaPeriodo += mAmt;
                        desgloseNominaPagada.push({ fecha: e.fecha, concepto: e.concepto, metodo: e.metodo_pago, monto: mAmt });
                        if (metodo === 'efectivo') salidasEfectivo += mAmt;
                        else if (metodo === 'transferencia' || metodo === 'tarjeta') salidasBanco += mAmt;
                    } else if (this.clasificarGasto(e) === 'reparto') {
                        // Reparto de utilidades a socios: sale dinero, pero es la utilidad yéndose a los
                        // dueños, no un gasto del taller — no se resta de la Utilidad Neta.
                        repartoPeriodo += mAmt;
                        desgloseReparto.push({ fecha: e.fecha, concepto: e.concepto, metodo: e.metodo_pago, monto: mAmt });
                        if (metodo === 'efectivo') salidasEfectivo += mAmt;
                        else if (metodo === 'transferencia' || metodo === 'tarjeta') salidasBanco += mAmt;
                    } else if (this.clasificarGasto(e) === 'fijo') {
                        // Pago real de renta/servicios/impuestos: la Utilidad ya los incluye por prorrateo.
                        gastosFijosPagados += mAmt;
                        fijosPagadosPorCategoria[e.categoria] = (fijosPagadosPorCategoria[e.categoria] || 0) + mAmt;
                        if (metodo === 'efectivo') salidasEfectivo += mAmt;
                        else if (metodo === 'transferencia' || metodo === 'tarjeta') salidasBanco += mAmt;
                    } else if (CATEGORIAS_NO_OPERATIVAS.includes(e.categoria)) {
                        // Devolución de préstamos/aportaciones de socios, o traspasos internos entre caja y
                        // banco: salen de caja pero NO son gasto operativo — no tocan la Utilidad Neta.
                        salidasNoOperativas += mAmt;
                        desgloseMovimientosNoOperativos.push({ fecha: e.fecha, tipo: '(-) Salida', categoria: e.categoria, concepto: e.concepto, metodo: e.metodo_pago, monto: mAmt });
                        if (metodo === 'efectivo') salidasEfectivo += mAmt;
                        else if (metodo === 'transferencia' || metodo === 'tarjeta') salidasBanco += mAmt;
                        montosPorCategoria[e.categoria] = (montosPorCategoria[e.categoria] || 0) + mAmt;
                    } else {
                        egresosManuales += mAmt;
                        if (metodo === 'efectivo') salidasEfectivo += mAmt;
                        else if (metodo === 'transferencia' || metodo === 'tarjeta') salidasBanco += mAmt;
                        montosPorCategoria[e.categoria] = (montosPorCategoria[e.categoria] || 0) + mAmt;
                        gastosPorCategoriaPDF[e.categoria] = (gastosPorCategoriaPDF[e.categoria] || 0) + mAmt;
                    }
                });

                const listaGastosPorCategoriaPDF = Object.keys(gastosPorCategoriaPDF)
                    .map(cat => ({ categoria: cat, monto: gastosPorCategoriaPDF[cat] }))
                    .sort((a, b) => b.monto - a.monto);

                // ---------- Ingresos No Operativos (capital/créditos/aportaciones/traspasos) ----------
                const ingresosExtraPeriodo = State.ingresosExtra.filter(i => {
                    const iDate = Utils.parseFechaLocal(i.fecha);
                    return iDate >= start && iDate <= end;
                });
                ingresosExtraPeriodo.forEach(i => {
                    const m = parseFloat(i.monto || 0);
                    if ((i.metodo_pago || '').toLowerCase() === 'efectivo') entradasEfectivo += m;
                    else entradasBanco += m;
                    entradasNoOperativas += m;
                    desgloseMovimientosNoOperativos.push({ fecha: i.fecha, tipo: '(+) Entrada', categoria: i.categoria, concepto: i.concepto, metodo: i.metodo_pago, monto: m });
                });
                desgloseMovimientosNoOperativos.sort((a, b) => Utils.parseFechaLocal(a.fecha) - Utils.parseFechaLocal(b.fecha));
                const netoNoOperativo = entradasNoOperativas - salidasNoOperativas;

                // Saldo histórico de préstamos de socios (acumulado — no depende del periodo del reporte)
                const totalPrestadoHistorico = State.ingresosExtra
                    .filter(i => i.categoria === "Crédito o Préstamo")
                    .reduce((acc, i) => acc + (parseFloat(i.monto) || 0), 0);
                const totalDevueltoHistorico = State.expenses
                    .filter(e => e.categoria === "Pago de Préstamos / Socios")
                    .reduce((acc, e) => acc + (parseFloat(e.monto) || 0), 0);
                const saldoPrestamosPendiente = totalPrestadoHistorico - totalDevueltoHistorico;

                // ---------- Nómina devengada (con descuentos aplicados) ----------
                const { total: costoNominaPeriodo, desglose: desglosePersonal } = this.computeNominaDevengada(start, end);

                // Costo real de nómina que se resta de la Utilidad: devengado MENOS descuentos ya aplicados.
                // (Antes el PDF usaba el devengado sin descontar — quedaba distinto al Dashboard.)
                const nominaFinalConDescuentos = costoNominaPeriodo - deduccionesNomina;

                // ---------- Control de pagos de nómina (correspondiente vs. pagada) ----------
                // Solo desde la fecha de arranque configurada: antes de esa fecha los pagos no se
                // capturaban en Tesorería, así que compararlos marcaría nómina "sin pagar" que sí se pagó.
                let aplicaControlNomina = false, nominaCorrespondienteControl = 0, nominaPagadaControl = 0, nominaPendientePago = 0;
                const inicioControlNomina = State.nominaControlInicio ? Utils.parseFechaLocal(State.nominaControlInicio) : null;
                if (inicioControlNomina && !isNaN(inicioControlNomina)) {
                    const ctrlStart = new Date(Math.max(start, new Date(inicioControlNomina.getFullYear(), inicioControlNomina.getMonth(), inicioControlNomina.getDate(), 0, 0, 0, 0)));
                    if (ctrlStart <= end) {
                        aplicaControlNomina = true;
                        const devengadoCtrl = this.computeNominaDevengada(ctrlStart, end).total;
                        let deduccionesCtrl = 0;
                        // Colaboradores con semana desfasada: el descuento por una incidencia se aplica en
                        // el pago de la semana SIGUIENTE, así que para comparar contra lo pagado se mueve
                        // 7 días. (La Utilidad no cambia: ahí el descuento cuenta en la semana en que ocurrió.)
                        const desfaseSet = new Set((State.nominaDesfase || []).map(String));
                        const incPorGasto = {};
                        ((typeof Attendance_Engine !== 'undefined' && Attendance_Engine.incidencias) || []).forEach(i => {
                            if (i.gasto_id) incPorGasto[String(i.gasto_id)] = i;
                        });
                        State.expenses.forEach(e => {
                            if (e.categoria !== 'Nómina') return;
                            let eDate = Utils.parseFechaLocal(e.fecha);
                            const m = Math.round(parseFloat(e.monto || 0) * 100) / 100;
                            if (m < 0) {
                                const inc = incPorGasto[String(e.id)];
                                if (inc && desfaseSet.has(String(inc.personal_id))) {
                                    eDate = new Date(eDate.getTime());
                                    eDate.setDate(eDate.getDate() + 7);
                                }
                            }
                            if (eDate < ctrlStart || eDate > end) return;
                            if (m < 0) deduccionesCtrl += Math.abs(m);
                            else nominaPagadaControl += m;
                        });
                        nominaCorrespondienteControl = devengadoCtrl - deduccionesCtrl;
                        nominaPendientePago = nominaCorrespondienteControl - nominaPagadaControl;
                    }
                }
                montosPorCategoria["Nómina"] = nominaFinalConDescuentos;
                montosPorCategoria["Refacciones"] = refaccionesCostNeto;

                // ---------- Gastos Fijos Prorrateados (Renta / Servicios / Impuestos) ----------
                const rentaMensual = parseFloat(State.fixedCosts.renta) || 0;
                const serviciosMensuales = parseFloat(State.fixedCosts.servicios) || 0;
                const impuestosMensuales = parseFloat(State.fixedCosts.impuestos) || 0;
                const rentaProrrateada = (rentaMensual / 30.4) * totalDays;
                const serviciosProrrateados = (serviciosMensuales / 30.4) * totalDays;
                const impuestosProrrateados = (impuestosMensuales / 30.4) * totalDays;
                const costoFijosPeriodo = rentaProrrateada + serviciosProrrateados + impuestosProrrateados;
                const totalGastosFijosProrrateados = costoFijosPeriodo;
                montosPorCategoria["Renta"] = rentaProrrateada;

                // ---------- Totales y Utilidad Neta (CÁLCULO ÚNICO Y CANÓNICO) ----------
                const totalGastos = refaccionesCostNeto + nominaFinalConDescuentos + costoFijosPeriodo + egresosManuales;
                const ventasNetasSinIva16 = ingresos - totalIva16Cobrado;
                const totalIngresosCobrados = ingresos;

                const utilidadBruta = ingresos - refaccionesCostNeto;
                const utilidadNeta = ventasNetasSinIva16 - totalGastos;
                const utilidadNetaPL = utilidadNeta; // mismo número, alias para el PDF por compatibilidad de nombres
                const margenUtilidad = ingresos > 0 ? (utilidadNeta / ingresos) * 100 : 0;
                const ticketPromedio = vehiculosAtendidos > 0 ? ingresos / vehiculosAtendidos : 0;

                const balanceIvaNeto = totalIva16Cobrado - totalIvaAcreditablePagado;
                const esIvaPorPagar = balanceIvaNeto >= 0;
                const utilidadDisponibleTrasIva = esIvaPorPagar ? (utilidadNeta - balanceIvaNeto) : utilidadNeta;

                const balEfectivo = entradasEfectivo - salidasEfectivo;
                const balBanco = entradasBanco - salidasBanco;

                // ---------- Cuentas por Cobrar del periodo ----------
                let cuentasPorCobrar = [];
                let totalPendienteCobro = 0;
                State.orders.forEach(o => {
                    if (o.estado === 'Cancelada') return;
                    const oDate = Utils.parseFechaLocal(o.fecha_ingreso || o.fecha_registro);
                    if (oDate >= start && oDate <= end) {
                        const totalOrden = parseFloat(o.total_cobrado || 0);
                        const abonosOrden = State.pagos
                            .filter(p => Number(p.orden_id) === Number(o.id))
                            .reduce((acc, p) => acc + (parseFloat(p.monto) || 0), 0);
                        const saldoPendiente = totalOrden - abonosOrden;
                        if (saldoPendiente > 0.5) {
                            totalPendienteCobro += saldoPendiente;
                            cuentasPorCobrar.push({
                                id: o.id,
                                cliente: o.cliente_nombre,
                                auto: `${o.auto_marca} (${o.auto_placas})`,
                                total: totalOrden,
                                abonado: abonosOrden,
                                pendiente: saldoPendiente
                            });
                        }
                    }
                });

                // ---------- Productividad de Mecánicos ----------
                let listaProductividad = [];
                const mecanicosList = State.personal.filter(p => p.rol && p.rol.includes('Mecánico'));
                mecanicosList.forEach(m => {
                    const ordenesMec = State.orders.filter(o => {
                        if (o.estado === 'Cancelada') return false;
                        const oDate = Utils.parseFechaLocal(o.fecha_ingreso || o.fecha_registro);
                        const matchMec = (o.tecnico_user_id && o.tecnico_user_id === m.user_id) ||
                                         (o.tecnico_asignado && o.tecnico_asignado.toLowerCase() === m.nombre?.toLowerCase());
                        return matchMec && (oDate >= start && oDate <= end);
                    });
                    const concluidas = ordenesMec.filter(o => o.estado === 'Terminado' || o.estado === 'Entregado');
                    let manoObraProducida = 0;
                    concluidas.forEach(o => manoObraProducida += parseFloat(o.costo_mano_obra || 0));
                    listaProductividad.push({ nombre: m.nombre, asignadas: ordenesMec.length, concluidas: concluidas.length, manoObra: manoObraProducida });
                });

                return {
                    start, end, totalDays,
                    vehiculosAtendidos, ingresos, pagado, anticipo, totalIva16Cobrado,
                    entradasEfectivo, entradasBanco, salidasEfectivo, salidasBanco,
                    entradasNoOperativas, salidasNoOperativas, netoNoOperativo, desgloseMovimientosNoOperativos,
                    listaOrdenesIngreso, ingresosPeriodo,
                    refaccionesCostBruto, refaccionesCostNeto, totalIvaAcreditablePagado,
                    listaComprasRefacciones, refaccionesPeriodo, comprasPorProveedor, gastosPeriodo,
                    egresosManuales, deduccionesNomina, montosPorCategoria, listaGastosPorCategoriaPDF,
                    costoNominaPeriodo, nominaFinalConDescuentos, desglosePersonal,
                    rentaMensual, serviciosMensuales, impuestosMensuales,
                    rentaProrrateada, serviciosProrrateados, impuestosProrrateados, costoFijosPeriodo, totalGastosFijosProrrateados,
                    totalGastos, ventasNetasSinIva16, totalIngresosCobrados,
                    utilidadBruta, utilidadNeta, utilidadNetaPL, margenUtilidad, ticketPromedio,
                    balanceIvaNeto, esIvaPorPagar, utilidadDisponibleTrasIva,
                    balEfectivo, balBanco,
                    cuentasPorCobrar, totalPendienteCobro,
                    listaProductividad,
                    conteoServicios, acumuladoManoObraOrdenes, acumuladoRefaccionesOrdenes,
                    totalPrestadoHistorico, totalDevueltoHistorico, saldoPrestamosPendiente,
                    nominaPagadaPeriodo, desgloseNominaPagada,
                    repartoPeriodo, desgloseReparto, gastosFijosPagados, fijosPagadosPorCategoria,
                    ivaRefaccionesCfdi, comprasSinSalidaDinero, refaccionesOrdenesSinCompra,
                    aplicaControlNomina, inicioControlNomina, nominaCorrespondienteControl, nominaPagadaControl, nominaPendientePago
                };
            },

            // ================================================================================
            // MOVIMIENTOS DE DINERO POR CUENTA (Efectivo / Banco) entre dos fechas.
            // Base del Corte de Caja por cuenta y del saldo calculado desde el arranque.
            // Usa exactamente las mismas reglas de clasificación y método de pago que la Utilidad.
            // ================================================================================
            async computeCashMovements(desde, hasta) {
                const LINEAS = ['cobros', 'ingresosNoOperativos', 'refacciones', 'gastosOperativos', 'nomina', 'gastosFijos', 'salidasNoOperativas', 'reparto'];
                const mk = () => { const o = {}; LINEAS.forEach(l => o[l] = 0); o.fijosPorCategoria = {}; return o; };
                const R = { efectivo: mk(), banco: mk() };
                const r2 = n => Math.round(n * 100) / 100;
                const dentro = (f) => { const d = Utils.parseFechaLocal(f); return d >= desde && d <= hasta; };
                const sumar = (cuenta, linea, monto) => { if (cuenta) R[cuenta][linea] = r2(R[cuenta][linea] + monto); };

                const vistos = new Set();
                State.pagos.forEach(p => {
                    if (p.id && vistos.has(p.id)) return;
                    if (p.id) vistos.add(p.id);
                    if (!dentro(p.fecha)) return;
                    sumar(this.cuentaDe(p.metodo_pago, true), 'cobros', r2(parseFloat(p.monto || 0)));
                });
                State.ingresosExtra.forEach(i => {
                    if (!dentro(i.fecha)) return;
                    sumar(this.cuentaDe(i.metodo_pago, true), 'ingresosNoOperativos', r2(parseFloat(i.monto || 0)));
                });
                State.expenses.forEach(e => {
                    if (!dentro(e.fecha)) return;
                    const m = r2(parseFloat(e.monto || 0));
                    const tipo = this.clasificarGasto(e);
                    if (tipo === 'deduccion_nomina') return; // ajuste interno, no sale dinero
                    const cuenta = this.cuentaDe(e.metodo_pago);
                    const linea = { nomina: 'nomina', reparto: 'reparto', no_operativo: 'salidasNoOperativas', fijo: 'gastosFijos', operativo: 'gastosOperativos' }[tipo];
                    sumar(cuenta, linea, m);
                    if (tipo === 'fijo' && cuenta) R[cuenta].fijosPorCategoria[e.categoria] = r2((R[cuenta].fijosPorCategoria[e.categoria] || 0) + m);
                });
                if (supabaseClient) {
                    try {
                        const { data } = await supabaseClient
                            .from('compras_refacciones')
                            .select('costo_neto, total_pagado, metodo_pago, fecha_compra')
                            .gte('fecha_compra', desde.toISOString())
                            .lte('fecha_compra', hasta.toISOString())
                            .order('fecha_compra', { ascending: true });
                        (data || []).forEach(c => sumar(this.cuentaDe(c.metodo_pago), 'refacciones', r2(parseFloat(c.costo_neto || c.total_pagado || 0))));
                    } catch (err) {
                        console.error('Error al obtener compras para movimientos de caja:', err);
                    }
                }
                ['efectivo', 'banco'].forEach(k => {
                    const x = R[k];
                    x.entradas = r2(x.cobros + x.ingresosNoOperativos);
                    x.salidas = r2(x.refacciones + x.gastosOperativos + x.nomina + x.gastosFijos + x.salidasNoOperativas + x.reparto);
                    x.neto = r2(x.entradas - x.salidas);
                });
                return R;
            },

            // ================================================================================
            // PUENTE UTILIDAD NETA → FLUJO DE CAJA
            // Explica renglón por renglón por qué la Utilidad y el flujo de dinero (efectivo + banco)
            // del mismo periodo son distintos. Como ambos salen de los mismos registros, la
            // "diferencia sin explicar" debe ser $0.00; si no lo es, hay un error de cálculo.
            // (Lo que NO se registró falta en ambos lados: eso lo detecta el arqueo, no el puente.)
            // ================================================================================
            computePuente(F, MOV) {
                const r2 = n => Math.round((n || 0) * 100) / 100;
                const suma = k => r2((MOV.efectivo[k] || 0) + (MOV.banco[k] || 0));
                const lineas = [
                    { id: 'iva', label: 'IVA 16% cobrado a clientes (está en caja, pero es del SAT)', monto: r2(F.totalIva16Cobrado) },
                    { id: 'noop_in', label: 'Préstamos, aportaciones y traspasos recibidos (no son venta)', monto: suma('ingresosNoOperativos') },
                    { id: 'ref_ordenes', label: 'Refacciones capturadas solo en la orden (costo sin pago registrado)', monto: r2(F.refaccionesOrdenesSinCompra) },
                    { id: 'ref_credito', label: 'Compras de refacciones a crédito (costo, aún no sale dinero)', monto: r2(F.comprasSinSalidaDinero) },
                    { id: 'iva_ref', label: 'IVA 8% pagado en refacciones con factura (sale dinero, no es costo)', monto: -r2(F.ivaRefaccionesCfdi) },
                    { id: 'nomina', label: 'Nómina que corresponde menos la pagada (+ pendiente / − pagada de más)', monto: r2(F.nominaFinalConDescuentos - suma('nomina')) },
                    { id: 'fijos', label: 'Gastos fijos que corresponden menos los pagados (renta, servicios, impuestos)', monto: r2(F.totalGastosFijosProrrateados - suma('gastosFijos')) },
                    { id: 'gastos_sin_salida', label: 'Gastos operativos registrados sin salida de efectivo/banco', monto: r2(F.egresosManuales - suma('gastosOperativos')) },
                    { id: 'noop_out', label: 'Devoluciones de préstamo y traspasos enviados', monto: -suma('salidasNoOperativas') },
                    { id: 'reparto', label: 'Reparto de utilidades a socios', monto: -suma('reparto') }
                ];
                const utilidad = r2(F.utilidadNeta);
                const flujoCalculado = r2(utilidad + lineas.reduce((a, l) => a + l.monto, 0));
                const flujoReal = r2(MOV.efectivo.neto + MOV.banco.neto);
                return { utilidad, lineas, flujoCalculado, flujoReal, diferencia: r2(flujoReal - flujoCalculado) };
            },

            // Saldos reales por cuenta a partir del ARRANQUE (conteo de caja + saldo de banco en una fecha,
            // capturado en Ajustes). Saldo inicial del periodo = arranque + movimientos desde el arranque
            // hasta antes del periodo. Saldo final = saldo inicial + movimientos del periodo.
            async computeSaldosCaja(start, end) {
                const arr = State.arranqueCaja;
                if (!arr || !arr.fecha) return { disponible: false, motivo: 'sin_arranque' };
                const fA = Utils.parseFechaLocal(arr.fecha);
                const fechaArranque = new Date(fA.getFullYear(), fA.getMonth(), fA.getDate(), 0, 0, 0, 0);
                if (end < fechaArranque) return { disponible: false, motivo: 'antes_del_arranque', fechaArranque };

                let iniEf = parseFloat(arr.efectivo) || 0, iniBc = parseFloat(arr.banco) || 0;
                let desdeMov = start;
                let inicioEnArranque = false;
                if (start <= fechaArranque) {
                    desdeMov = fechaArranque;
                    inicioEnArranque = true;
                } else {
                    const previo = await this.computeCashMovements(fechaArranque, new Date(start.getTime() - 1));
                    iniEf += previo.efectivo.neto;
                    iniBc += previo.banco.neto;
                }
                const mov = await this.computeCashMovements(desdeMov, end);
                const r2 = n => Math.round(n * 100) / 100;
                return {
                    disponible: true, fechaArranque, inicioEnArranque, mov,
                    inicial: { efectivo: r2(iniEf), banco: r2(iniBc) },
                    final: { efectivo: r2(iniEf + mov.efectivo.neto), banco: r2(iniBc + mov.banco.neto) }
                };
            },

            // Saldo al inicio de un día (para el Flujo de Caja). null si no hay arranque configurado.
            async saldoAlInicioDe(fecha) {
                const arr = State.arranqueCaja;
                if (!arr || !arr.fecha) return null;
                const fA = Utils.parseFechaLocal(arr.fecha);
                const fechaArranque = new Date(fA.getFullYear(), fA.getMonth(), fA.getDate(), 0, 0, 0, 0);
                const ef = parseFloat(arr.efectivo) || 0, bc = parseFloat(arr.banco) || 0;
                if (fecha <= fechaArranque) return { efectivo: ef, banco: bc, fechaArranque };
                const previo = await this.computeCashMovements(fechaArranque, new Date(fecha.getTime() - 1));
                return { efectivo: Math.round((ef + previo.efectivo.neto) * 100) / 100, banco: Math.round((bc + previo.banco.neto) * 100) / 100, fechaArranque };
            },

            // Nómina devengada (lo que corresponde pagar) entre dos fechas, prorrateando el sueldo
            // semanal de cada colaborador por los días que estuvo activo dentro del rango.
            computeNominaDevengada(start, end) {
                let total = 0;
                const desglose = [];
                State.personal.forEach(p => {
                    if (p.fecha_egreso && Utils.parseFechaLocal(p.fecha_egreso) < start) return;
                    if (p.fecha_ingreso && Utils.parseFechaLocal(p.fecha_ingreso) > end) return;

                    const sueldoSemanal = parseFloat(p.sueldo) || 0;
                    const sueldoDiario = sueldoSemanal / 7;

                    const empInicio = p.fecha_ingreso ? Utils.parseFechaLocal(p.fecha_ingreso) : start;
                    const empFin = p.fecha_egreso ? Utils.parseFechaLocal(p.fecha_egreso) : end;

                    const inicioInterseccion = new Date(Math.max(start, empInicio));
                    const finInterseccion = new Date(Math.min(end, empFin));

                    if (inicioInterseccion <= finInterseccion) {
                        const diasTrabajados = Utils.getDaysInRange(inicioInterseccion, finInterseccion);
                        const montoCorrespondiente = diasTrabajados * sueldoDiario;
                        total += montoCorrespondiente;
                        desglose.push({
                            nombre: p.nombre,
                            puesto: p.rol,
                            sueldoSemanal: sueldoSemanal,
                            dias: diasTrabajados,
                            monto: montoCorrespondiente
                        });
                    }
                });
                return { total, desglose };
            },

            // ================================================================================
            // AUTO-DIAGNÓSTICO: corre casos de prueba conocidos contra computeCoreFinancials
            // para detectar si algún cambio futuro rompió el cálculo de Utilidad Neta — antes
            // de que alguien lo note viendo un PDF ya impreso. No se ejecuta solo; se dispara
            // manualmente desde Ajustes con el botón "Ejecutar Pruebas".
            // ================================================================================
            async runSelfTest() {
                // Respaldo del estado real y de la conexión real a Supabase, para restaurarlos
                // pase lo que pase (incluso si una prueba truena a medias).
                const backupState = {
                    orders: State.orders, pagos: State.pagos, expenses: State.expenses,
                    personal: State.personal, ingresosExtra: State.ingresosExtra, fixedCosts: State.fixedCosts,
                    nominaControlInicio: State.nominaControlInicio, nominaDesfase: State.nominaDesfase, arranqueCaja: State.arranqueCaja,
                    incidencias: (typeof Attendance_Engine !== 'undefined') ? Attendance_Engine.incidencias : null
                };
                const backupSupabase = supabaseClient;

                const results = [];
                const assertClose = (label, actual, expected, tol = 0.5) => {
                    const ok = Math.abs((actual || 0) - expected) <= tol;
                    results.push({ label, actual, expected, ok });
                };
                const mockSupabase = (comprasFixture) => ({
                    from: (table) => {
                        const chain = {
                            select: () => chain, gte: () => chain, lte: () => chain,
                            order: () => Promise.resolve({ data: table === 'compras_refacciones' ? comprasFixture : [], error: null })
                        };
                        return chain;
                    }
                });

                try {
                    // ---------- Escenario 1: estado completamente vacío ----------
                    // Detecta errores gruesos (NaN, excepciones, valores que no deberían salir de 0).
                    State.orders = []; State.pagos = []; State.expenses = [];
                    State.personal = []; State.ingresosExtra = [];
                    State.fixedCosts = { renta: 0, servicios: 0, impuestos: 0 };
                    State.nominaControlInicio = null;
                    supabaseClient = mockSupabase([]);

                    const start1 = new Date(2026, 0, 1, 0, 0, 0, 0);
                    const end1 = new Date(2026, 0, 7, 23, 59, 59, 999);
                    const R1 = await this.computeCoreFinancials(start1, end1);

                    assertClose('Estado vacío: Ingresos = $0', R1.ingresos, 0);
                    assertClose('Estado vacío: Utilidad Neta = $0', R1.utilidadNeta, 0);
                    assertClose('Estado vacío: Gastos Totales = $0', R1.totalGastos, 0);
                    assertClose('Estado vacío: Vehículos Atendidos = 0', R1.vehiculosAtendidos, 0);

                    // ---------- Escenario 2: caso completo ----------
                    // Cubre las reglas más delicadas que ya se han corregido en este ERP: nómina con
                    // descuento aplicado, préstamo de socio, devolución de préstamo, IVA acreditable
                    // combinado (refacciones + gastos con CFDI), y cuentas por cobrar.
                    const start2 = new Date(2026, 0, 1, 0, 0, 0, 0);
                    const end2 = new Date(2026, 0, 7, 23, 59, 59, 999);

                    State.orders = [{
                        id: 9001, estado: 'En Proceso', fecha_ingreso: '2026-01-03',
                        cliente_nombre: 'Cliente Prueba', auto_marca: 'Nissan', auto_placas: 'TEST-001',
                        costo_mano_obra: 1000, costo_refacciones: 0, requiere_factura: true,
                        total_cobrado: 2620, conceptos: []
                    }];
                    State.pagos = [{
                        id: 8001, orden_id: 9001, fecha: '2026-01-03', monto: 2320,
                        metodo_pago: 'Efectivo', tipo: 'pago'
                    }];
                    State.expenses = [
                        { fecha: '2026-01-04', monto: 100, categoria: 'Gasolina', metodo_pago: 'Efectivo', tiene_cfdi: false, concepto: 'Gasolina prueba' },
                        { fecha: '2026-01-04', monto: -50, categoria: 'Nómina', metodo_pago: 'Efectivo', tiene_cfdi: false, concepto: 'Descuento prueba' },
                        { fecha: '2026-01-05', monto: 200, categoria: 'Pago de Préstamos / Socios', metodo_pago: 'Efectivo', tiene_cfdi: false, concepto: 'Devolución préstamo prueba' },
                        { fecha: '2026-01-05', monto: 108, categoria: 'Herramientas', metodo_pago: 'Transferencia', tiene_cfdi: true, concepto: 'Herramienta prueba' },
                        // Pago real de nómina capturado en Tesorería: sale de caja, pero NO debe restarse
                        // otra vez de la Utilidad (ya entra por lo devengado)
                        { fecha: '2026-01-06', monto: 700, categoria: 'Nómina', metodo_pago: 'Efectivo', tiene_cfdi: false, concepto: 'Pago nómina prueba' }
                    ];
                    State.nominaControlInicio = '2026-01-01';
                    State.ingresosExtra = [
                        { fecha: '2026-01-02', monto: 500, categoria: 'Crédito o Préstamo', metodo_pago: 'Efectivo', concepto: 'Préstamo prueba' }
                    ];
                    State.personal = [
                        { nombre: 'Mecánico Prueba', rol: 'Mecánico', sueldo: 700, fecha_ingreso: '2025-01-01', fecha_egreso: null, user_id: 'test-mec-1' }
                    ];
                    State.fixedCosts = { renta: 304, servicios: 0, impuestos: 0 };

                    supabaseClient = mockSupabase([{
                        id: 7001, descripcion: 'Refacción prueba', proveedor: 'Proveedor Prueba',
                        costo_neto: 432, total_pagado: 432, iva: 32, tiene_cfdi: true,
                        metodo_pago: 'Tarjeta', fecha_compra: '2026-01-03T12:00:00.000Z', orden_id: 9001
                    }]);

                    const R2 = await this.computeCoreFinancials(start2, end2);

                    assertClose('Caso completo: Refacciones Netas (sin IVA) = $400', R2.refaccionesCostNeto, 400);
                    assertClose('Caso completo: IVA Acreditable Total (refacciones + gastos) = $40', R2.totalIvaAcreditablePagado, 40);
                    assertClose('Caso completo: Nómina Neta de Descuentos = $650', R2.nominaFinalConDescuentos, 650);
                    assertClose('Caso completo: Gastos Fijos Prorrateados (7 días) = $70', R2.totalGastosFijosProrrateados, 70);
                    assertClose('Caso completo: Gastos Operativos Manuales = $208', R2.egresosManuales, 208);
                    assertClose('Caso completo: Ventas Netas sin IVA = $2,000', R2.ventasNetasSinIva16, 2000);
                    assertClose('Caso completo: Utilidad Neta = $672', R2.utilidadNeta, 672);
                    assertClose('Caso completo: Balance de IVA a Pagar = $280', R2.balanceIvaNeto, 280);
                    assertClose('Caso completo: Utilidad Disponible tras IVA = $392', R2.utilidadDisponibleTrasIva, 392);
                    assertClose('Caso completo: Saldo de Préstamos Pendiente = $300', R2.saldoPrestamosPendiente, 300);
                    assertClose('Caso completo: Movimiento No Operativo Neto = $300', R2.netoNoOperativo, 300);
                    assertClose('Caso completo: Cuentas por Cobrar = $300', R2.totalPendienteCobro, 300);
                    assertClose('Caso completo: Saldo Neto de Efectivo (incluye pago de nómina) = $1,820', R2.balEfectivo, 1820);
                    assertClose('Nómina: pago capturado en Tesorería = $700', R2.nominaPagadaPeriodo, 700);
                    assertClose('Nómina: el pago NO se duplica en Gastos Operativos (sigue $208)', R2.egresosManuales, 208);
                    assertClose('Nómina: correspondiente neta en control = $650', R2.nominaCorrespondienteControl, 650);
                    assertClose('Nómina: diferencia (pagado de más) = -$50', R2.nominaPendientePago, -50);
                    assertClose('Caso completo: Saldo Neto de Banco = -$540', R2.balBanco, -540);
                    const P2 = this.computePuente(R2, await this.computeCashMovements(start2, end2));
                    assertClose('Puente Utilidad → Flujo (caso completo): diferencia sin explicar = $0', P2.diferencia, 0, 0.01);

                    // ---------- Escenario 3: control de nómina con fecha de arranque a media semana ----------
                    // Antes del arranque no se cuentan ni lo devengado ni los pagos (no se capturaban).
                    State.nominaControlInicio = '2026-01-05';
                    const R3 = await this.computeCoreFinancials(start2, end2);
                    assertClose('Nómina con arranque 5-ene: correspondiente (3 días) = $300', R3.nominaCorrespondienteControl, 300);
                    assertClose('Nómina con arranque 5-ene: pendiente de pago = -$400', R3.nominaPendientePago, -400);
                    assertClose('Nómina con arranque 5-ene: Utilidad Neta no cambia = $672', R3.utilidadNeta, 672);
                    State.nominaControlInicio = '2026-02-01';
                    const R4 = await this.computeCoreFinancials(start2, end2);
                    assertClose('Nómina: periodo anterior al arranque no aplica control', R4.aplicaControlNomina ? 1 : 0, 0);

                    // ---------- Escenario 5: semana desfasada ----------
                    // Falta el sábado 3-ene con descuento de $100 a un colaborador con semana desfasada:
                    // la Utilidad la resta en esa semana, pero el control la espera en el pago de la siguiente.
                    State.nominaControlInicio = '2025-12-01';
                    State.nominaDesfase = ['55'];
                    State.personal = [{ id: 55, nombre: 'Mecánico Desfasado', rol: 'Mecánico', sueldo: 700, fecha_ingreso: '2025-01-01', fecha_egreso: null }];
                    State.expenses = [
                        { id: 'g-falta', fecha: '2026-01-03', monto: -100, categoria: 'Nómina', metodo_pago: 'Efectivo', concepto: 'Descuento falta' },
                        { id: 'g-pago1', fecha: '2026-01-03', monto: 700, categoria: 'Nómina', metodo_pago: 'Efectivo', concepto: 'Pago semana anterior' },
                        { id: 'g-pago2', fecha: '2026-01-10', monto: 600, categoria: 'Nómina', metodo_pago: 'Efectivo', concepto: 'Pago con descuento' }
                    ];
                    State.pagos = []; State.orders = []; State.ingresosExtra = [];
                    State.fixedCosts = { renta: 0, servicios: 0, impuestos: 0 };
                    if (typeof Attendance_Engine !== 'undefined') Attendance_Engine.incidencias = [{ personal_id: 55, fecha: '2026-01-03', gasto_id: 'g-falta', descuento: 100 }];
                    supabaseClient = mockSupabase([]);
                    const S1 = await this.computeCoreFinancials(new Date(2025, 11, 29, 0, 0, 0, 0), new Date(2026, 0, 4, 23, 59, 59, 999));
                    const S2 = await this.computeCoreFinancials(new Date(2026, 0, 5, 0, 0, 0, 0), new Date(2026, 0, 11, 23, 59, 59, 999));
                    assertClose('Desfase: semana de la falta — Utilidad descuenta la falta (nómina neta $600)', S1.nominaFinalConDescuentos, 600);
                    assertClose('Desfase: semana de la falta — control cuadra (pagado completo)', S1.nominaPendientePago, 0);
                    assertClose('Desfase: semana siguiente — control cuadra con el pago descontado', S2.nominaPendientePago, 0);

                    // ---------- Escenario 6: renta pagada, reparto a socios y saldos desde el arranque ----------
                    State.nominaDesfase = [];
                    State.personal = [];
                    State.orders = [];
                    State.pagos = [
                        { id: 'p1', fecha: '2026-03-02', monto: 1000, metodo_pago: 'Efectivo', tipo: 'pago' },
                        { id: 'p2', fecha: '2026-03-09', monto: 2000, metodo_pago: 'Efectivo', tipo: 'pago' },
                        { id: 'p3', fecha: '2026-03-10', monto: 500, metodo_pago: 'Transferencia', tipo: 'pago' }
                    ];
                    State.ingresosExtra = [];
                    State.fixedCosts = { renta: 3040, servicios: 0, impuestos: 0 }; // $100/día de renta prorrateada
                    State.expenses = [
                        { id: 'r1', fecha: '2026-03-10', monto: 3040, categoria: 'Renta', metodo_pago: 'Transferencia', concepto: 'Renta marzo' },
                        { id: 'l1', fecha: '2026-03-10', monto: 300, categoria: 'Luz', metodo_pago: 'Efectivo', concepto: 'Luz (sin prorrateo de servicios)' },
                        { id: 'u1', fecha: '2026-03-14', monto: 800, categoria: 'Reparto de Utilidades (Retiro de Socios)', metodo_pago: 'Efectivo', concepto: 'Reparto socio' }
                    ];
                    State.arranqueCaja = { fecha: '2026-03-01', efectivo: 5000, banco: 10000 };
                    supabaseClient = mockSupabase([]);
                    const A = await this.computeCoreFinancials(new Date(2026, 2, 9, 0, 0, 0, 0), new Date(2026, 2, 15, 23, 59, 59, 999));
                    assertClose('Renta pagada en Tesorería NO se duplica en gastos (solo prorrateo $700)', A.totalGastosFijosProrrateados, 700);
                    assertClose('Renta pagada: fuera de gastos operativos; Luz sin prorrateo sí cuenta ($300)', A.egresosManuales, 300);
                    assertClose('Reparto a socios no reduce la Utilidad (2,500 − 700 − 300 = $1,500)', A.utilidadNeta, 1500);
                    assertClose('Reparto registrado en el periodo = $800', A.repartoPeriodo, 800);
                    const SC = await this.computeSaldosCaja(new Date(2026, 2, 9, 0, 0, 0, 0), new Date(2026, 2, 15, 23, 59, 59, 999));
                    assertClose('Saldo inicial efectivo al 9-mar = arranque 5,000 + cobro 1,000 = $6,000', SC.inicial.efectivo, 6000);
                    assertClose('Saldo final efectivo = 6,000 + 2,000 − 300 − 800 = $6,900', SC.final.efectivo, 6900);
                    assertClose('Saldo final banco = 10,000 + 500 − 3,040 = $7,460', SC.final.banco, 7460);
                    assertClose('Movimientos por cuenta cuadran con el flujo neto de la Utilidad (efectivo)', SC.mov.efectivo.neto, A.balEfectivo);
                    assertClose('Movimientos por cuenta cuadran con el flujo neto de la Utilidad (banco)', SC.mov.banco.neto, A.balBanco);
                    const P6 = this.computePuente(A, SC.mov);
                    assertClose('Puente Utilidad → Flujo (renta, reparto, luz): diferencia sin explicar = $0', P6.diferencia, 0, 0.01);


                } catch (err) {
                    results.push({ label: `❌ Error inesperado durante las pruebas: ${err.message}`, actual: null, expected: null, ok: false });
                } finally {
                    // Restaura el estado real y la conexión real a Supabase sin importar el resultado.
                    State.orders = backupState.orders;
                    State.pagos = backupState.pagos;
                    State.expenses = backupState.expenses;
                    State.personal = backupState.personal;
                    State.ingresosExtra = backupState.ingresosExtra;
                    State.fixedCosts = backupState.fixedCosts;
                    State.nominaControlInicio = backupState.nominaControlInicio;
                    State.nominaDesfase = backupState.nominaDesfase;
                    State.arranqueCaja = backupState.arranqueCaja;
                    if (typeof Attendance_Engine !== 'undefined' && backupState.incidencias) Attendance_Engine.incidencias = backupState.incidencias;
                    supabaseClient = backupSupabase;
                }

                return results;
            },

            async recalculate() {
                const preset = document.getElementById('erp-date-preset').value;
                const { start, end } = this.getDateRange(preset);

                const F = await this.computeCoreFinancials(start, end);
                const {
                    totalDays, vehiculosAtendidos, ingresos, pagado, anticipo, totalIva16Cobrado,
                    refaccionesCostNeto, egresosManuales, nominaFinalConDescuentos, costoFijosPeriodo,
                    totalGastos, ventasNetasSinIva16, utilidadBruta, utilidadNeta, margenUtilidad, ticketPromedio,
                    montosPorCategoria, listaOrdenesIngreso, listaComprasRefacciones,
                    totalIvaAcreditablePagado, conteoServicios, acumuladoManoObraOrdenes, acumuladoRefaccionesOrdenes
                } = F;

                if (document.getElementById('dash-ingresos')) {
                    document.getElementById('dash-ingresos').innerText = Utils.formatter.format(ingresos);
                    document.getElementById('dash-utilidad-bruta').innerText = Utils.formatter.format(utilidadBruta);
                    document.getElementById('dash-egresos').innerText = Utils.formatter.format(totalGastos);
                    document.getElementById('dash-utilidad').innerText = Utils.formatter.format(utilidadNeta);
                    document.getElementById('dash-vehiculos').innerText = vehiculosAtendidos;
                    document.getElementById('dash-ticket-promedio').innerText = Utils.formatter.format(ticketPromedio);
                    document.getElementById('dash-margen').innerText = `${margenUtilidad.toFixed(1)}%`;
                    
                    if (document.getElementById('caja-pagado')) document.getElementById('caja-pagado').innerText = Utils.formatter.format(pagado);
                    if (document.getElementById('caja-anticipo')) document.getElementById('caja-anticipo').innerText = Utils.formatter.format(anticipo);
                    if (document.getElementById('costo-ref-total')) document.getElementById('costo-ref-total').innerText = Utils.formatter.format(refaccionesCostNeto);
                    if (document.getElementById('costo-fijos-total')) document.getElementById('costo-fijos-total').innerText = Utils.formatter.format(costoFijosPeriodo);
                    if (document.getElementById('costo-nomina-total')) document.getElementById('costo-nomina-total').innerText = Utils.formatter.format(nominaFinalConDescuentos);
            
                    if (document.getElementById('er-ingresos')) document.getElementById('er-ingresos').innerText = Utils.formatter.format(ventasNetasSinIva16);
                    if (document.getElementById('er-refacciones')) document.getElementById('er-refacciones').innerText = Utils.formatter.format(montosPorCategoria["Refacciones"]);
                    if (document.getElementById('er-nomina')) document.getElementById('er-nomina').innerText = Utils.formatter.format(montosPorCategoria["Nómina"]);
                    if (document.getElementById('er-gasolina')) document.getElementById('er-gasolina').innerText = Utils.formatter.format((montosPorCategoria["Gasolina"] || 0) + (montosPorCategoria["Diesel"] || 0));
                    if (document.getElementById('er-consumibles')) document.getElementById('er-consumibles').innerText = Utils.formatter.format(montosPorCategoria["Consumibles"] || 0);
                    
                    const sumServiciosAcumulados = (montosPorCategoria["Renta"] || 0) + (montosPorCategoria["Agua"] || 0) + (montosPorCategoria["Luz"] || 0) + (montosPorCategoria["Internet"] || 0);
                    if (document.getElementById('er-servicios')) document.getElementById('er-servicios').innerText = Utils.formatter.format(sumServiciosAcumulados);
                    if (document.getElementById('er-publicidad')) document.getElementById('er-publicidad').innerText = Utils.formatter.format(montosPorCategoria["Publicidad"] || 0);
                    
                    const otrosAcumulados = totalGastos - (montosPorCategoria["Refacciones"] + montosPorCategoria["Nómina"] + (montosPorCategoria["Gasolina"] || 0) + (montosPorCategoria["Diesel"] || 0) + (montosPorCategoria["Consumibles"] || 0) + sumServiciosAcumulados + (montosPorCategoria["Publicidad"] || 0));
                    if (document.getElementById('er-otros')) document.getElementById('er-otros').innerText = Utils.formatter.format(otrosAcumulados > 0 ? otrosAcumulados : 0);
                    if (document.getElementById('er-utilidad-neta')) document.getElementById('er-utilidad-neta').innerText = Utils.formatter.format(utilidadNeta);

                    const catContainer = document.getElementById('dashboard-categories-container');
                    if (catContainer) {
                        let categoriesHtml = Object.keys(montosPorCategoria)
                            .filter(cName => cName !== "Refacciones" && (montosPorCategoria[cName] || 0) > 0)
                            .map(cName => `
                                <div class="flex justify-between items-center border-b border-slate-100 pb-1.5 text-xs">
                                    <span class="text-slate-600 font-medium">${Utils.escapeHtml(cName)}:</span>
                                    <span class="font-bold text-slate-800">${Utils.formatter.format(montosPorCategoria[cName])}</span>
                                </div>`)
                            .join('');
                    
                        if (!categoriesHtml) {
                            categoriesHtml = `<p class="text-xs text-slate-400 text-center py-2">Sin gastos registrados por categoría en este periodo.</p>`;
                        }
                    
                        // --- SECCIÓN FISCAL DE IVA DE PREFERENCIA ---
                        const balanceIva = totalIva16Cobrado - totalIvaAcreditablePagado;
                        const ivaHtml = `
                            <div class="mt-3 pt-2 border-t border-slate-200 flex flex-col gap-1.5 bg-slate-50 p-2.5 rounded-xl border">
                                <span class="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Balance de IVA del Periodo</span>
                                
                                <div class="flex justify-between items-center text-xs">
                                    <span class="text-emerald-700 font-medium flex items-center gap-1">
                                        <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> IVA Trasladado (Cobrado):
                                    </span>
                                    <span class="font-bold text-emerald-700">${Utils.formatter.format(totalIva16Cobrado)}</span>
                                </div>
                    
                                <div class="flex justify-between items-center text-xs">
                                    <span class="text-rose-700 font-medium flex items-center gap-1">
                                        <span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span> IVA Acreditable (Pagado):
                                    </span>
                                    <span class="font-bold text-rose-700">${Utils.formatter.format(totalIvaAcreditablePagado)}</span>
                                </div>
                    
                                <div class="flex justify-between items-center text-xs pt-1 border-t border-slate-200 font-extrabold ${balanceIva >= 0 ? 'text-amber-700' : 'text-blue-700'}">
                                    <span>${balanceIva >= 0 ? '🏛️ IVA Estimado a Pagar:' : '🏛️ IVA a Favor / Acreditable:'}</span>
                                    <span>${Utils.formatter.format(Math.abs(balanceIva))}</span>
                                </div>
                            </div>
                        `;
                    
                        catContainer.innerHTML = categoriesHtml + ivaHtml;
                    }
                }

                const incomeBody = document.getElementById('dashboard-income-orders-body');
                if (incomeBody) {
                    if (listaOrdenesIngreso.length === 0) {
                        incomeBody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-400">Sin registros de ingresos en este periodo.</td></tr>`;
                    } else {
                        incomeBody.innerHTML = listaOrdenesIngreso.map(i => {
                            const fStr = i.fecha.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
                            return `
                                <tr class="hover:bg-slate-50 transition border-b border-slate-100">
                                    <td class="py-2.5 px-4 font-medium text-slate-500">${fStr}</td>
                                    <td class="py-2.5 px-4 font-bold text-slate-900">#${i.ordenId}</td>
                                    <td class="py-2.5 px-4">
                                        <span class="font-semibold text-slate-800 block">${Utils.escapeHtml(i.cliente)}</span>
                                        <span class="text-[10px] text-slate-400 block">${Utils.escapeHtml(i.auto)}</span>
                                    </td>
                                    <td class="py-2.5 px-4">
                                        <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 uppercase border border-slate-200">
                                            ${Utils.escapeHtml(i.metodo)} (${Utils.escapeHtml(i.tipo)})
                                        </span>
                                    </td>
                                    <td class="py-2.5 px-4 text-right font-bold text-emerald-600">${Utils.formatter.format(i.monto)}</td>
                                </tr>
                            `;
                        }).join('');
                    }
                }
    
                const partsBody = document.getElementById('dashboard-parts-cost-body');
                if (partsBody) {
                    if (listaComprasRefacciones.length === 0) {
                        partsBody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400">Sin compras de refacciones en este periodo.</td></tr>`;
                    } else {
                        partsBody.innerHTML = listaComprasRefacciones.map(r => {
                            const fStr = r.fecha.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
                            return `
                                <tr class="hover:bg-slate-50 transition border-b border-slate-100">
                                    <td class="py-2.5 px-4 font-medium text-slate-500">${fStr}</td>
                                    <td class="py-2.5 px-4 font-bold text-blue-600">${r.ordenId}</td>
                                    <td class="py-2.5 px-4">
                                        <span class="font-semibold text-slate-800 block">${Utils.escapeHtml(r.descripcion)}</span>
                                        <span class="text-[10px] text-slate-400 block">${Utils.escapeHtml(r.cliente)}</span>
                                    </td>
                                    <td class="py-2.5 px-4 font-medium text-slate-600">${Utils.escapeHtml(r.proveedor)}</td>
                                    <td class="py-2.5 px-4">
                                        <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                                            ${Utils.escapeHtml(r.metodo)}
                                        </span>
                                    </td>
                                    <td class="py-2.5 px-4 text-right font-bold text-slate-900">${Utils.formatter.format(r.costo)}</td>
                                </tr>
                            `;
                        }).join('');
                    }
                }
    
                // Puente Utilidad → Flujo de Caja del mismo periodo
                const puenteCont = document.getElementById('dash-puente');
                if (puenteCont) {
                    try {
                        const MOV = await this.computeCashMovements(start, end);
                        puenteCont.innerHTML = UI_Controller.puenteHTML(this.computePuente(F, MOV), false);
                    } catch (err) {
                        console.error('Error al calcular el puente Utilidad → Flujo:', err);
                    }
                }

                // Llamar al renderizador enviando los datos acumulados
                this.renderCharts(montosPorCategoria, conteoServicios, acumuladoManoObraOrdenes, acumuladoRefaccionesOrdenes);
            },
            
            renderCharts(montosPorCategoria, conteoServicios, acumuladoMO, acumuladoRef) {
                // 1. Limpieza de instancias previas
                if (chartInstanceCategoria) chartInstanceCategoria.destroy();
                if (chartInstanceTopServicios) chartInstanceTopServicios.destroy();
                if (chartInstanceMoVsRef) chartInstanceMoVsRef.destroy();

                // -------------------------------------------------------------
                // GRÁFICA 1: GASTOS POR CATEGORÍA (Dona con porcentaje)
                // -------------------------------------------------------------
                const ctx1 = document.getElementById('chart-gastos-categoria');
                if (ctx1) {
                    const catLabels = Object.keys(montosPorCategoria).filter(k => (montosPorCategoria[k] || 0) > 0);
                    const catData = catLabels.map(k => montosPorCategoria[k]);
                    const totalEgresos = catData.reduce((a, b) => a + b, 0);

                    chartInstanceCategoria = new Chart(ctx1, {
                        type: 'doughnut',
                        data: {
                            labels: catLabels.length > 0 ? catLabels : ['Sin gastos'],
                            datasets: [{
                                data: catData.length > 0 ? catData : [0],
                                backgroundColor: [
                                    '#3b82f6', '#10b981', '#ef4444', '#f59e0b', 
                                    '#8b5cf6', '#ec4899', '#64748b', '#06b6d4', 
                                    '#14b8a6', '#a855f7'
                                ]
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                                legend: {
                                    labels: {
                                        font: { size: 10 },
                                        filter: function(item, chartData) {
                                            const val = chartData.datasets[0].data[item.index];
                                            return val > 0;
                                        }
                                    }
                                },
                                tooltip: {
                                    callbacks: {
                                        label: function(context) {
                                            const value = context.parsed || 0;
                                            const pct = totalEgresos > 0 ? ((value / totalEgresos) * 100).toFixed(1) : 0;
                                            return ` ${context.label}: ${Utils.formatter.format(value)} (${pct}%)`;
                                        }
                                    }
                                }
                            }
                        }
                    });
                }

                // -------------------------------------------------------------
                // GRÁFICA 2: TOP 5 SERVICIOS MÁS VENDIDOS (Barras Horizontales)
                // -------------------------------------------------------------
                const ctx2 = document.getElementById('chart-top-servicios');
                if (ctx2) {
                    const sortedServicios = Object.keys(conteoServicios)
                        .map(key => ({ nombre: key, cantidad: conteoServicios[key] }))
                        .sort((a, b) => b.cantidad - a.cantidad)
                        .slice(0, 5);

                    const topLabels = sortedServicios.length > 0 ? sortedServicios.map(s => s.nombre) : ['Sin datos'];
                    const topData = sortedServicios.length > 0 ? sortedServicios.map(s => s.cantidad) : [0];

                    chartInstanceTopServicios = new Chart(ctx2, {
                        type: 'bar',
                        data: {
                            labels: topLabels,
                            datasets: [{
                                label: 'Servicios Ejecutados',
                                data: topData,
                                backgroundColor: '#3b82f6',
                                borderRadius: 6
                            }]
                        },
                        options: {
                            indexAxis: 'y',
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                                legend: { display: false },
                                tooltip: {
                                    callbacks: {
                                        label: (ctx) => ` Cantidad: ${ctx.parsed.x} unidades`
                                    }
                                }
                            },
                            scales: {
                                x: { ticks: { stepSize: 1, font: { size: 10 } } },
                                y: { ticks: { font: { size: 10 } } }
                            }
                        }
                    });
                }

                // -------------------------------------------------------------
                // GRÁFICA 3: MANO DE OBRA VS REFACCIONES (Anillo Comparativo)
                // -------------------------------------------------------------
                const ctx3 = document.getElementById('chart-mo-vs-ref');
                if (ctx3) {
                    const totalCombinado = acumuladoMO + acumuladoRef;

                    chartInstanceMoVsRef = new Chart(ctx3, {
                        type: 'doughnut',
                        data: {
                            labels: ['Mano de Obra', 'Refacciones'],
                            datasets: [{
                                data: totalCombinado > 0 ? [acumuladoMO, acumuladoRef] : [0, 0],
                                backgroundColor: ['#10b981', '#f59e0b']
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                                legend: { labels: { font: { size: 10 } } },
                                tooltip: {
                                    callbacks: {
                                        label: function(context) {
                                            const value = context.parsed || 0;
                                            const pct = totalCombinado > 0 ? ((value / totalCombinado) * 100).toFixed(1) : 0;
                                            return ` ${context.label}: ${Utils.formatter.format(value)} (${pct}%)`;
                                        }
                                    }
                                }
                            }
                        }
                    });
                }
            }
        };

