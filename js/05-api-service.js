        const API_Service = {
            _lastSync: { orders: 0, personal: 0, expenses: 0, pagos: 0, ingresosExtra: 0 },
            STALE_MS: 60000,

            async fetchOrders(force = false) {
                const isFresh = !force && (Date.now() - this._lastSync.orders) < this.STALE_MS;
                if (!isFresh && supabaseClient) {
                    try {
                        const { data: ordersData, error: ordersError } = await supabaseClient
                            .from('ordenes_trabajo')
                           .select('id, cliente_nombre, cliente_telefono, auto_marca, auto_modelo, auto_placas, kilometraje, tecnico_asignado, tecnico_user_id, estado, costo_mano_obra, costo_refacciones, total_cobrado, estado_pago, metodo_pago, fecha_ingreso, fecha_egreso, requiere_factura, total_iva, conceptos, facturado')
                            .order('id', { ascending: false });
                        
                        if (ordersError) throw ordersError;
                        State.orders = (ordersData || []).map(o => ({ 
                            ...o, 
                            conceptos: Array.isArray(o.conceptos) ? o.conceptos : JSON.parse(o.conceptos || '[]') 
                        }));

                        const { data: pagosData, error: pagosError } = await supabaseClient
                            .from('pagos')
                            .select('*')
                            .order('fecha', { ascending: false });
                            
                        if (!pagosError) {
                            State.pagos = pagosData || [];
                        }

                        this._lastSync.orders = Date.now();
                    } catch (error) { 
                        State.orders = []; 
                        showToast(`Error al sincronizar datos: ${error.message}`, true); 
                    }
                }
                
                UI_Controller.renderOrdersList();
                UI_Controller.populateQuoteOrdersDropdown();
                UI_Controller.renderTreasuryData();
                UI_Controller.renderMecanicosStats();
                Financial_Engine.recalculate();
                Cashflow_Engine.recalculate();
            },

            async fetchPagos(force = false) {
                const isFresh = !force && (Date.now() - this._lastSync.pagos) < this.STALE_MS;
                if (!isFresh && supabaseClient) {
                    try {
                        const { data, error } = await supabaseClient
                            .from('pagos')
                            .select('*')
                            .order('fecha', { ascending: false });
                        if (error) throw error;
                        State.pagos = data || [];
                        this._lastSync.pagos = Date.now();
                    } catch (error) { State.pagos = []; }
                }
            },

            async fetchPersonal(force = false) {
                const isFresh = !force && (Date.now() - this._lastSync.personal) < this.STALE_MS;
                if (!isFresh && supabaseClient) {
                    try {
                        if (State.currentRole === 'Administrador' || State.currentRole === 'Contabilidad/Finanzas') {
                            const { data, error } = await supabaseClient
                                .from('personal')
                                .select('*')
                                .order('nombre', { ascending: true });
                            if (error) throw error;
                            State.personal = data || [];
                        } else {
                            const { data, error } = await supabaseClient
                                .from('directorio_tecnicos')
                                .select('*')
                                .order('nombre', { ascending: true });
                            if (error) throw error;
                            State.personal = data || [];
                        }
                        this._lastSync.personal = Date.now();
                    } catch (error) { 
                        State.personal = []; 
                        showToast(`No fue posible cargar el personal: ${error.message}`, true); 
                    }
                }
                UI_Controller.renderPersonalList();
                UI_Controller.populateTecnicosDropdowns();
                UI_Controller.renderMecanicosStats();
                Financial_Engine.recalculate();
            },

            async fetchExpenses(force = false) {
                const isFresh = !force && (Date.now() - this._lastSync.expenses) < this.STALE_MS;
                if (!isFresh && supabaseClient) {
                    try {
                        const { data, error } = await supabaseClient.from('gastos').select('*').order('fecha', { ascending: false });
                        if (error) throw error;
                        State.expenses = data || [];
                        this._lastSync.expenses = Date.now();
                    } catch (error) { State.expenses = []; showToast(`No fue posible cargar los gastos: ${error.message}`, true); }
                }
                UI_Controller.renderTreasuryData();
                Financial_Engine.recalculate();
                Cashflow_Engine.recalculate();
            },

            async fetchIngresosExtra(force = false) {
                const isFresh = !force && (Date.now() - this._lastSync.ingresosExtra) < this.STALE_MS;
                if (!isFresh && supabaseClient) {
                    try {
                        const { data, error } = await supabaseClient.from('ingresos_extra').select('*').order('fecha', { ascending: false });
                        if (error) throw error;
                        State.ingresosExtra = data || [];
                        this._lastSync.ingresosExtra = Date.now();
                    } catch (error) { State.ingresosExtra = []; showToast(`No fue posible cargar los ingresos adicionales: ${error.message}`, true); }
                }
                UI_Controller.renderTreasuryData();
                Cashflow_Engine.recalculate();
            },

            // Configuración crítica del negocio (renta/gastos fijos, % de reparto entre socios, saldo
            // inicial de caja/banco). Antes vivía solo en localStorage del navegador — si alguien entraba
            // desde otra computadora, o le compartía el ERP a su socio, no la veían. Ahora vive en Supabase
            // y es la misma para todos los que usan el sistema.
            async fetchConfigERP() {
                if (!supabaseClient) return;
                try {
                    const { data, error } = await supabaseClient.from('configuracion_erp').select('*');
                    if (error) throw error;

                    const configMap = {};
                    (data || []).forEach(row => { configMap[row.clave] = row.valor; });

                    // --- Migración de valores que hayan quedado guardados en este navegador (versión
                    // anterior, antes de existir esta tabla) para no perder lo que ya se había capturado ---
                    if (!configMap.fixed_costs) {
                        const legacy = localStorage.getItem('fixed_operational_costs_final');
                        if (legacy) {
                            try {
                                configMap.fixed_costs = JSON.parse(legacy);
                                await this.saveConfigValue('fixed_costs', configMap.fixed_costs);
                            } catch (e) { /* valor viejo corrupto, se ignora */ }
                        }
                    }
                    if (!configMap.socios_reparto) {
                        const legacy = localStorage.getItem('socios_reparto_config');
                        if (legacy) {
                            try {
                                configMap.socios_reparto = JSON.parse(legacy);
                                await this.saveConfigValue('socios_reparto', configMap.socios_reparto);
                            } catch (e) { /* valor viejo corrupto, se ignora */ }
                        }
                    }
                    if (!configMap.saldo_inicial_caja) {
                        const legacyEf = parseFloat(localStorage.getItem('befix_saldo_inicial_caja_efectivo'));
                        const legacyBc = parseFloat(localStorage.getItem('befix_saldo_inicial_caja_banco'));
                        const legacyViejo = parseFloat(localStorage.getItem('befix_saldo_inicial_caja'));
                        if (!isNaN(legacyEf) || !isNaN(legacyBc) || !isNaN(legacyViejo)) {
                            configMap.saldo_inicial_caja = {
                                efectivo: !isNaN(legacyEf) ? legacyEf : (!isNaN(legacyViejo) ? legacyViejo : 0),
                                banco: !isNaN(legacyBc) ? legacyBc : 0
                            };
                            await this.saveConfigValue('saldo_inicial_caja', configMap.saldo_inicial_caja);
                        }
                    }

                    if (configMap.fixed_costs) State.fixedCosts = configMap.fixed_costs;
                    if (configMap.socios_reparto && Array.isArray(configMap.socios_reparto) && configMap.socios_reparto.length > 0) {
                        State.sociosReparto = configMap.socios_reparto;
                    }
                    if (configMap.saldo_inicial_caja) State.saldoInicialCaja = configMap.saldo_inicial_caja;

                    UI_Controller.loadFixedCosts();
                    UI_Controller.loadSociosReparto();
                    Cashflow_Engine.recalculate();
                } catch (error) {
                    console.error('Error al cargar configuración del ERP:', error);
                    showToast('No se pudo cargar la configuración guardada en el servidor (renta, reparto, saldo inicial). Se usan valores por defecto.', true);
                    UI_Controller.loadFixedCosts();
                    UI_Controller.loadSociosReparto();
                }
            },

            async saveConfigValue(clave, valor) {
                if (!supabaseClient) return;
                try {
                    const { error } = await supabaseClient
                        .from('configuracion_erp')
                        .upsert({
                            clave,
                            valor,
                            actualizado_por: document.getElementById('user-display-name')?.innerText || 'Administrador',
                            updated_at: new Date().toISOString()
                        }, { onConflict: 'clave' });
                    if (error) throw error;
                } catch (error) {
                    console.error(`Error al guardar configuración "${clave}":`, error);
                    showToast('No se pudo guardar ese cambio de configuración en el servidor.', true);
                }
            },

            async refreshAll() {
                await Promise.all([this.fetchOrders(true), this.fetchPersonal(true), this.fetchExpenses(true), this.fetchIngresosExtra(true), this.fetchConfigERP()]);
            },

            async registrarCompraRefaccion(datosCompra) {
                const { data, error } = await supabaseClient
                    .from('compras_refacciones')
                    .insert([datosCompra])
                    .select();
                    
                if (error) throw error;
                return data[0];
            },

            async obtenerComprasPorOrden(ordenId) {
                const { data, error } = await supabaseClient
                    .from('compras_refacciones')
                    .select('*')
                    .eq('orden_id', ordenId)
                    .order('fecha_compra', { ascending: true });
                    
                if (error) throw error;
                return data;
            },

            async eliminarCompraRefaccion(compraId) {
                const { error } = await supabaseClient
                    .from('compras_refacciones')
                    .delete()
                    .eq('id', compraId);
                    
                if (error) throw error;
            },

            // --- MÉTODOS SUPABASE STORAGE Y REGISTRO DE NOTAS PDF ---
            async subirArchivoPdf(ordenId, file, monto) {
                // Sanitiza el nombre quitando acentos, espacios y caracteres especiales
                const cleanFileName = file.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9.-]/g, "_");
                const filePath = `orden_${ordenId}/${Date.now()}_${cleanFileName}`;
                
                const { data: storageData, error: storageError } = await supabaseClient
                    .storage
                    .from('comprobantes-ordenes')
                    .upload(filePath, file);

                if (storageError) throw storageError;

                const { data: urlData } = supabaseClient
                    .storage
                    .from('comprobantes-ordenes')
                    .getPublicUrl(filePath);

                const { data, error: dbError } = await supabaseClient
                    .from('orden_gastos')
                    .insert([{
                        orden_id: ordenId,
                        nombre_archivo: file.name,
                        archivo_url: urlData.publicUrl,
                        monto: monto
                    }])
                    .select();

                if (dbError) throw dbError;
                return data[0];
            },

            async obtenerPdfsPorOrden(ordenId) {
                const { data, error } = await supabaseClient
                    .from('orden_gastos')
                    .select('*')
                    .eq('orden_id', ordenId)
                    .order('created_at', { ascending: false });

                if (error) throw error;
                return data;
            },

            async eliminarPdfGasto(id) {
                const { error } = await supabaseClient
                    .from('orden_gastos')
                    .delete()
                    .eq('id', id);

                if (error) throw error;
            }
        };

