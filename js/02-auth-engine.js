        const Auth_Engine = {
            async handleLogin(e) {
                e.preventDefault();
                const email = document.getElementById('login-email').value;
                const password = document.getElementById('login-password').value;
                showToast("Autenticando...");

                try {
                    const { data, error } = await Client.auth.signInWithPassword({ email, password });
                    if (error) { showToast("Acceso denegado: " + error.message, true); return; }

                    const { data: profile, error: profileError } = await Client
                        .from('directorio_tecnicos')
                        .select('rol, nombre')
                        .eq('user_id', data.user.id)
                        .single();

                    if (profileError || !profile) {
                        const { data: adminProfile } = await supabaseClient
                            .from('personal')
                            .select('rol, nombre')
                            .eq('user_id', data.user.id)
                            .single();
                        
                        if (adminProfile) {
                            State.currentRole = adminProfile.rol;
                            document.getElementById('user-display-name').innerText = adminProfile.nombre;
                        } else {
                            await supabaseClient.auth.signOut();
                            showToast("Esta cuenta no tiene un perfil autorizado.", true);
                            return;
                        }
                    } else {
                        State.currentRole = profile.rol;
                        document.getElementById('user-display-name').innerText = profile.nombre;
                    }

                    document.getElementById('erp-login-screen').classList.add('hidden');
                    document.getElementById('user-display-role').innerText = State.currentRole;
                    showToast("Acceso concedido.");
                    UI_Controller.applyRolePermissions();
                    UI_Controller.switchTab('ordenes');
                } catch (err) {
                    showToast("Error crítico en la llamada de red.", true);
                }
            },

            async handleLogout() {
                if (supabaseClient) await supabaseClient.auth.signOut();
                State.currentRole = "Mecánico"; 
                document.getElementById('login-form').reset();
                document.getElementById('erp-login-screen').classList.remove('hidden');
                showToast("Sesión cerrada de forma segura.");
            },

            async checkExistingSession() {
                if (supabaseClient) {
                    const { data: { session } } = await supabaseClient.auth.getSession();
                    if (session) {
                        const { data: profile } = await supabaseClient
                            .from('directorio_tecnicos')
                            .select('rol, nombre')
                            .eq('user_id', session.user.id)
                            .single();

                        if (profile) {
                            State.currentRole = profile.rol;
                            document.getElementById('user-display-name').innerText = profile.nombre;
                        } else {
                            const { data: adminProfile } = await supabaseClient
                                .from('personal')
                                .select('rol, nombre')
                                .eq('user_id', session.user.id)
                                .single();

                            if (adminProfile) {
                                State.currentRole = adminProfile.rol;
                                document.getElementById('user-display-name').innerText = adminProfile.nombre;
                            }
                        }

                        document.getElementById('user-display-role').innerText = State.currentRole;
                        document.getElementById('erp-login-screen').classList.add('hidden');
                        UI_Controller.applyRolePermissions();
                        return;
                    }
                }
                document.getElementById('erp-login-screen').classList.remove('hidden');
            }
        };

