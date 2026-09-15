        let supabaseClient = null;

        function initArchitecture() {
            UI_Controller.loadFixedCosts();
            UI_Controller.loadSociosReparto();
            UI_Controller.populateCategoriesDropdown();
            
            const todayStr = new Date().toISOString().split('T')[0];
            if(document.getElementById('expense-date')) { document.getElementById('expense-date').value = todayStr; }
            if(document.getElementById('extra-income-date')) { document.getElementById('extra-income-date').value = todayStr; }
            if(document.getElementById('transfer-date')) { document.getElementById('transfer-date').value = todayStr; }
            if(document.getElementById('form-fecha-ingreso')) { document.getElementById('form-fecha-ingreso').value = todayStr; }
            if(document.getElementById('personal-fecha-ingreso')) { document.getElementById('personal-fecha-ingreso').value = todayStr; }
            
            const url = "https://krhauwvbbjlihkeasrju.supabase.co"; 
            const key = "sb_publishable_FaCORWb3dFbMfSNST-VQwQ_lihLEkdx";

            try {
                supabaseClient = supabase.createClient(url, key);
                
                document.getElementById('connection-status').className = "px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-full text-xs font-semibold flex items-center gap-1";
                document.getElementById('connection-status').innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span><span>🟢 ERP Producción</span>`;
                
                Auth_Engine.checkExistingSession().then(async () => {
                    UI_Controller.applyRolePermissions();
                    if (typeof API_Service !== 'undefined') {
                        // Carga y espera a que todos los datos estén listos antes de calcular
                        await API_Service.refreshAll();
                    }
                });
            
            } catch (err) {
                document.getElementById('connection-status').innerHTML = `<span>⚠️ Falla de Inicialización</span>`;
            }
            
            UI_Controller.applyRolePermissions();
            
            const searchInput = document.getElementById('search-bar');
            if (searchInput) {
                const handleSearchDebounced = Utils.debounce(() => {
                    UI_Controller.renderOrdersList();
                }, 250);
            
                searchInput.addEventListener('input', handleSearchDebounced);
            }
        }

        function customConfirm(title, message, callback) {
            document.getElementById('confirm-title').innerText = title;
            document.getElementById('confirm-message').innerText = message;
            State.confirmCallback = callback;
            document.getElementById('modal-confirm').classList.remove('hidden');
        }

        window.onload = function() { 
            initArchitecture(); 
            setTimeout(() => { Financial_Engine.handlePresetChange(); }, 300);
        };
