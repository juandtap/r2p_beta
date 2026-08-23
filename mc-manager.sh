#!/bin/bash

# ==============================================================================
# Stuip-id Minecraft Server Manager
# ==============================================================================

# Colores para la interfaz
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Directorios de trabajo
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MINECRAFT_DIR="$SCRIPT_DIR/minecraft"
SERVERS_DIR="$SCRIPT_DIR/servers"

# Asegurar que el directorio de servidores existe
mkdir -p "$SERVERS_DIR"

# Determina la mejor versión de Java a usar basada en el nombre del archivo / versión
get_java_cmd() {
    local jar_path="$1"
    
    # Comprobar si java-17 está disponible en rutas conocidas
    local java17_bin=""
    for candidate in "/usr/lib/jvm/java-17-openjdk/bin/java" \
                     "/usr/lib/jvm/java-17-openjdk-amd64/bin/java" \
                     "/usr/lib/jvm/java-17/bin/java"; do
        if [ -x "$candidate" ]; then
            java17_bin="$candidate"
            break
        fi
    done
    
    # Si la versión de Minecraft indicada en el jar es <= 1.20.4, se prefiere Java 17
    local use_java17=0
    if [[ "$jar_path" =~ 1\.(1[0-9]|20)(\.[0-9]+)? ]]; then
        use_java17=1
    fi
    
    if [ "$use_java17" -eq 1 ] && [ -n "$java17_bin" ]; then
        echo "$java17_bin"
    else
        echo "java"
    fi
}

# Determina la versión de Minecraft basada en los archivos del servidor
get_minecraft_version() {
    local server_dir="$1"
    local jar_file
    jar_file=$(ls "$server_dir"/*.jar 2>/dev/null | head -n 1)
    
    if [ -n "$jar_file" ]; then
        local filename
        filename=$(basename "$jar_file")
        local version
        version=$(echo "$filename" | grep -oE "1\.[0-9]+(\.[0-9]+)?" | head -n 1)
        if [ -z "$version" ]; then
            version=$(echo "$filename" | grep -oE "[0-9]+\.[0-9]+(\.[0-9]+)?" | head -n 1)
        fi
        
        if [ -n "$version" ]; then
            if [[ "$filename" == *"forge"* ]]; then
                echo "Forge $version"
            else
                echo "Vanilla $version"
            fi
            return 0
        fi
    fi
    echo "Desconocida"
}

# ------------------------------------------------------------------------------
# Helpers de estado y selección
# ------------------------------------------------------------------------------

# Comprueba si un servidor específico está corriendo
is_running() {
    local server_name="$1"
    local server_dir="$SERVERS_DIR/$server_name"
    if [ -f "$server_dir/server.pid" ]; then
        local pid
        pid=$(cat "$server_dir/server.pid")
        if [ -n "$pid" ] && ps -p "$pid" > /dev/null 2>&1; then
            return 0
        fi
    fi
    return 1
}

# Helper interactivo para seleccionar un servidor de la lista de creados
select_server_interactive() {
    local prompt="$1"
    local servers=()
    
    # Leer subcarpetas en el directorio de servidores
    for d in "$SERVERS_DIR"/*; do
        if [ -d "$d" ]; then
            servers+=("$(basename "$d")")
        fi
    done
    
    if [ ${#servers[@]} -eq 0 ]; then
        echo -e "${RED}Error: No hay servidores creados actualmente.${NC}" >&2
        return 1
    fi
    
    echo -e "${BLUE}$prompt${NC}" >&2
    select server in "${servers[@]}"; do
        if [ -n "$server" ]; then
            echo "$server"
            return 0
        else
            echo -e "${RED}Selección no válida. Intente de nuevo.${NC}" >&2
        fi
    done
}

# Helper para iniciar un servidor
iniciar_servidor() {
    local server_name="$1"
    local server_dir="$SERVERS_DIR/$server_name"
    
    if [ -z "$server_name" ]; then
        echo -e "${RED}Error: Nombre de servidor no provisto.${NC}"
        return 1
    fi
    
    if [ ! -d "$server_dir" ]; then
        echo -e "${RED}Error: El servidor '$server_name' no existe.${NC}"
        return 1
    fi
    
    if is_running "$server_name"; then
        echo -e "${YELLOW}El servidor '$server_name' ya está activo.${NC}"
        return 0
    fi
    
    # Check if eula.txt exists and has eula=true, otherwise write it
    if [ ! -f "$server_dir/eula.txt" ] || ! grep -q "eula=true" "$server_dir/eula.txt"; then
        echo "eula=true" > "$server_dir/eula.txt"
    fi
    
    cd "$server_dir" || return 1
    
    # Resolver la versión de java adecuada
    local ref_jar
    ref_jar=$(ls *.jar 2>/dev/null | head -n 1)
    local java_cmd
    java_cmd=$(get_java_cmd "$ref_jar")
    
    # Configurar variables de entorno si estamos usando una ruta de Java alternativa
    if [ "$java_cmd" != "java" ]; then
        local java_dir
        java_dir=$(dirname "$java_cmd")
        export PATH="$java_dir:$PATH"
        export JAVA_HOME="${java_dir%/bin}"
    fi
    
    # Configurar argumentos JVM para preferir IPv4 y asignar memoria en Forge
    if [ -f "user_jvm_args.txt" ]; then
        if ! grep -q "preferIPv4Stack" user_jvm_args.txt; then
            echo "" >> user_jvm_args.txt
            echo "-Djava.net.preferIPv4Stack=true" >> user_jvm_args.txt
        fi
        if ! grep -q "Xmx" user_jvm_args.txt; then
            echo "" >> user_jvm_args.txt
            echo "-Xmx1024M" >> user_jvm_args.txt
            echo "-Xms1024M" >> user_jvm_args.txt
        fi
    fi

    # Determine the execution command
    local cmd=""
    if [ -f "run.sh" ]; then
        chmod +x run.sh
        # Pasar nogui al run.sh de Forge para desactivar la interfaz gráfica
        cmd="./run.sh nogui"
    else
        # Find forge or vanilla jar (exclude installers)
        local jar_file
        jar_file=$(ls *.jar 2>/dev/null | grep -v "installer" | head -n 1)
        if [ -z "$jar_file" ]; then
            jar_file=$(ls *.jar 2>/dev/null | head -n 1)
        fi
        
        if [ -n "$jar_file" ]; then
            # Incluir preferIPv4Stack para obligar a usar IPv4
            cmd="$java_cmd -Djava.net.preferIPv4Stack=true -Xmx1024M -Xms1024M -jar $jar_file nogui"
        fi
    fi
    
    if [ -z "$cmd" ]; then
        echo -e "${RED}Error: No se encontró ningún archivo ejecutable (.jar o run.sh) en '$server_name'.${NC}"
        return 1
    fi
    
    echo -e "${GREEN}Iniciando el servidor '$server_name'...${NC}"
    
    if command -v tmux >/dev/null 2>&1; then
        echo -e "Iniciando en sesión de tmux: ${CYAN}mc-$server_name${NC}"
        tmux -f /dev/null new-session -d -s "mc-$server_name" "sh -c 'cd \"$server_dir\" && echo \$\$ > server.pid && exec $cmd > stdout.log 2>&1'"
        # Darle unos segundos para que se ejecute y cree el PID
        sleep 3
        if [ -f "$server_dir/server.pid" ]; then
            local pid
            pid=$(cat "$server_dir/server.pid")
            echo -e "${GREEN}Servidor '$server_name' iniciado en tmux (PID: $pid).${NC}"
            echo -e "${YELLOW}Puedes conectarte a la consola interactiva usando: tmux attach -t mc-$server_name${NC}"
        else
            echo -e "${RED}Error al iniciar el servidor en tmux. Revisa '$server_dir/stdout.log'.${NC}"
            return 1
        fi
    else
        echo -e "${YELLOW}Advertencia: tmux no está instalado. Usando fallback con nohup...${NC}"
        nohup $cmd > stdout.log 2>&1 < /dev/null &
        local pid=$!
        echo "$pid" > server.pid
        disown "$pid" 2>/dev/null
        
        sleep 3
        if ps -p "$pid" > /dev/null; then
            echo -e "${GREEN}Servidor '$server_name' iniciado (PID: $pid).${NC}"
        else
            echo -e "${RED}El servidor falló al iniciar o aún está levantándose. Revisa '$server_dir/stdout.log' y 'logs/latest.log'.${NC}"
            rm -f server.pid
            return 1
        fi
    fi
}

# ------------------------------------------------------------------------------
# 1. Crear Servidor
# ------------------------------------------------------------------------------
crear_servidor() {
    echo -e "${BLUE}=== Crear Servidor de Minecraft ===${NC}"
    local server_name="$1"
    local selected_template="$2"
    
    # Validar que exista el directorio minecraft/
    if [ ! -d "$MINECRAFT_DIR" ]; then
        echo -e "${RED}Error: La carpeta '$MINECRAFT_DIR' no existe.${NC}"
        return 1
    fi
    
    # Listar los archivos disponibles
    local templates=()
    for f in "$MINECRAFT_DIR"/*; do
        if [ -f "$f" ]; then
            templates+=("$(basename "$f")")
        fi
    done
    
    if [ ${#templates[@]} -eq 0 ]; then
        echo -e "${RED}No hay archivos base (.jar) en la carpeta 'minecraft'.${NC}"
        return 1
    fi
    
    if [ -z "$selected_template" ]; then
        echo -e "${YELLOW}Seleccione el archivo base de Minecraft/Forge:${NC}"
        select opt in "${templates[@]}"; do
            if [ -n "$opt" ]; then
                selected_template="$opt"
                break
            else
                echo -e "${RED}Selección inválida. Intente de nuevo.${NC}"
            fi
        done
    elif [[ ! "$selected_template" =~ ^[a-zA-Z0-9._-]+\.jar$ ]] || [ ! -f "$MINECRAFT_DIR/$selected_template" ]; then
        echo -e "${RED}Error: La plantilla '$selected_template' no existe o no es un .jar válido.${NC}"
        return 1
    fi
    
    # Pedir nombre del servidor
    while [ -z "$server_name" ]; do
        read -rp "Ingrese el nombre del nuevo servidor (letras, números, guiones): " input_name
        # Limpiar caracteres no deseados
        server_name=$(echo "$input_name" | tr -cd 'a-zA-Z0-9_-')
        if [ -z "$server_name" ]; then
            echo -e "${RED}El nombre no puede estar vacío y debe contener solo caracteres válidos.${NC}"
        fi
    done

    if [[ ! "$server_name" =~ ^[a-zA-Z0-9_-]+$ ]]; then
        echo -e "${RED}Error: El nombre debe contener únicamente letras, números, _ o -.${NC}"
        return 1
    fi
    
    local server_dir="$SERVERS_DIR/$server_name"
    if [ -d "$server_dir" ]; then
        echo -e "${RED}Error: Ya existe un servidor con el nombre '$server_name'.${NC}"
        return 1
    fi
    
    # Crear carpeta del servidor
    echo -e "${GREEN}Creando directorio del servidor en: $server_dir...${NC}"
    mkdir -p "$server_dir"
    
    # Copiar plantilla
    local src_file="$MINECRAFT_DIR/$selected_template"
    echo -e "Copiando $selected_template a la carpeta del servidor..."
    cp "$src_file" "$server_dir/"
    
    # Si es un instalador de Forge, lo ejecutamos para instalar el servidor
    if [[ "$selected_template" == *"installer"* ]]; then
        echo -e "${YELLOW}Es un instalador de Forge. Ejecutando instalación de servidor...${NC}"
        cd "$server_dir" || return 1
        
        local java_cmd
        java_cmd=$(get_java_cmd "$selected_template")
        
        if command -v "$java_cmd" >/dev/null 2>&1 || [ -x "$java_cmd" ]; then
            echo -e "Instalando Forge con '${CYAN}$java_cmd${NC}' (esto puede tomar un momento)..."
            "$java_cmd" -jar "$selected_template" --installServer > installer.log 2>&1
            if [ $? -eq 0 ]; then
                echo -e "${GREEN}Instalación de Forge finalizada con éxito.${NC}"
            else
                echo -e "${RED}Error al instalar Forge. Verifique '$server_dir/installer.log'.${NC}"
            fi
        else
            echo -e "${RED}Error: Java no está instalado. No se pudo ejecutar el instalador.${NC}"
        fi
    fi
    
    # Aceptar automáticamente el EULA de Minecraft
    echo "eula=true" > "$server_dir/eula.txt"
    
    # Generar un archivo server.properties inicial por defecto
    cat <<EOF > "$server_dir/server.properties"
# Minecraft Server Properties
# Generated by Stuip-id Server Manager
server-port=25565
query.port=25565
motd=Minecraft Server: $server_name
online-mode=true
difficulty=easy
max-players=20
EOF
    
    echo -e "${GREEN}¡Servidor '$server_name' creado y configurado con éxito!${NC}"
}

# ------------------------------------------------------------------------------
# 2. Administrar Servidor
# ------------------------------------------------------------------------------
administrar_servidor() {
    local server_name="$1"
    if [ -z "$server_name" ]; then
        server_name=$(select_server_interactive "Seleccione el servidor a administrar:")
        [ $? -ne 0 ] && return 1
    fi
    
    local server_dir="$SERVERS_DIR/$server_name"
    local props_file="$server_dir/server.properties"
    
    if [ ! -d "$server_dir" ]; then
        echo -e "${RED}Error: El servidor '$server_name' no existe.${NC}"
        return 1
    fi
    
    if [ ! -f "$props_file" ]; then
        echo -e "${YELLOW}Advertencia: server.properties no existe en '$server_name'. Generando uno nuevo...${NC}"
        cat <<EOF > "$props_file"
server-port=25565
query.port=25565
motd=Minecraft Server: $server_name
online-mode=true
difficulty=easy
max-players=20
EOF
    fi
    
    # Si se pasan parámetros directos para modificar una clave y valor
    if [ -n "$2" ] && [ -n "$3" ]; then
        local key="$2"
        local val="$3"
        if grep -q "^$key=" "$props_file"; then
            sed -i "s|^$key=.*|$key=$val|" "$props_file"
        else
            echo "$key=$val" >> "$props_file"
        fi
        echo -e "${GREEN}Propiedad '$key' actualizada a '$val' en el servidor '$server_name'.${NC}"
        return 0
    fi
    
    # Menú interactivo de propiedades
    while true; do
        echo -e "\n${BLUE}=== Administrar Servidor: $server_name ===${NC}"
        echo "1) Mostrar propiedades actuales"
        echo "2) Cambiar o añadir una propiedad"
        echo "3) Regresar al menú principal"
        read -rp "Seleccione una opción: " opt
        
        case "$opt" in
            1)
                echo -e "\n${YELLOW}--- Propiedades actuales en server.properties ---${NC}"
                grep -v "^#" "$props_file" | sort
                ;;
            2)
                read -rp "Ingrese la clave de la propiedad (ej: server-port, motd, level-seed): " key
                if [ -z "$key" ]; then
                    echo -e "${RED}Clave no válida.${NC}"
                    continue
                fi
                
                local current_val
                current_val=$(grep "^$key=" "$props_file" | cut -d'=' -f2)
                if [ -n "$current_val" ]; then
                    echo -e "Valor actual de '$key': ${CYAN}$current_val${NC}"
                else
                    echo -e "La propiedad '$key' no está definida."
                fi
                
                read -rp "Ingrese el nuevo valor: " val
                
                # Actualizar propiedad
                if grep -q "^$key=" "$props_file"; then
                    sed -i "s|^$key=.*|$key=$val|" "$props_file"
                else
                    echo "$key=$val" >> "$props_file"
                fi
                echo -e "${GREEN}Propiedad '$key' actualizada a '$val'.${NC}"
                ;;
            3)
                break
                ;;
            *)
                echo -e "${RED}Opción no válida.${NC}"
                ;;
        esac
    done
}

# ------------------------------------------------------------------------------
# 3. Listar Servidor
# ------------------------------------------------------------------------------
listar_servidor() {
    echo -e "${BLUE}=== Servidores Creados ===${NC}"
    printf "${BOLD}%-20s %-15s %-15s %-10s %-8s${NC}\n" "Nombre" "Versión" "Estado" "Puerto" "PID"
    printf "%-20s %-15s %-15s %-10s %-8s\n" "--------------------" "---------------" "---------------" "----------" "--------"
    
    local found=0
    for d in "$SERVERS_DIR"/*; do
        if [ -d "$d" ]; then
            found=1
            local name
            name=$(basename "$d")
            local version
            version=$(get_minecraft_version "$d")
            local status_str
            local color
            local pid="-"
            
            if is_running "$name"; then
                status_str="Activo"
                color="$GREEN"
                pid=$(cat "$d/server.pid")
            else
                status_str="Inactivo"
                color="$RED"
            fi
            
            # Buscar el puerto en server.properties
            local port="25565" # por defecto
            if [ -f "$d/server.properties" ]; then
                local prop_port
                prop_port=$(grep "^server-port=" "$d/server.properties" | cut -d'=' -f2)
                if [ -n "$prop_port" ]; then
                    port="$prop_port"
                fi
            fi
            
            printf "%-20s %-15s ${color}%-15s${NC} %-10s %-8s\n" "$name" "$version" "$status_str" "$port" "$pid"
        fi
    done
    
    if [ "$found" -eq 0 ]; then
        echo -e "${YELLOW}No se encontraron servidores de Minecraft creados en '$SERVERS_DIR'.${NC}"
    fi
}

# ------------------------------------------------------------------------------
# 4. Borrar Servidor
# ------------------------------------------------------------------------------
borrar_servidor() {
    local server_name="$1"
    local force_delete="$2"
    if [ -z "$server_name" ]; then
        server_name=$(select_server_interactive "Seleccione el servidor que desea borrar:")
        [ $? -ne 0 ] && return 1
    fi
    
    local server_dir="$SERVERS_DIR/$server_name"
    if [ ! -d "$server_dir" ]; then
        echo -e "${RED}Error: El servidor '$server_name' no existe.${NC}"
        return 1
    fi
    
    if [ "$force_delete" != "--force" ]; then
        # Mantener confirmación interactiva para uso manual.
        echo -e "${RED}${BOLD}!!! ADVERTENCIA DE ELIMINACIÓN !!!${NC}"
        echo -e "${RED}Esto eliminará de forma permanente el servidor '$server_name' y todos sus mundos y archivos.${NC}"
        read -rp "Para confirmar, por favor escriba exactamente el nombre del servidor ($server_name): " confirm

        if [ "$confirm" != "$server_name" ]; then
            echo -e "${YELLOW}Cancelado. El nombre no coincide.${NC}"
            return 1
        fi
    fi
    
    # Detener servidor primero si está activo
    if is_running "$server_name"; then
        echo -e "${YELLOW}El servidor está activo. Deteniéndolo primero...${NC}"
        detener "$server_name"
    fi
    
    echo -e "Eliminando directorio del servidor en $server_dir..."
    rm -rf "$server_dir"
    echo -e "${GREEN}¡El servidor '$server_name' ha sido borrado con éxito!${NC}"
}

# ------------------------------------------------------------------------------
# 5. Detener Servidor
# ------------------------------------------------------------------------------
detener() {
    local server_name="$1"
    if [ -z "$server_name" ]; then
        server_name=$(select_server_interactive "Seleccione el servidor a detener:")
        [ $? -ne 0 ] && return 1
    fi
    
    local server_dir="$SERVERS_DIR/$server_name"
    if [ ! -d "$server_dir" ]; then
        echo -e "${RED}Error: El servidor '$server_name' no existe.${NC}"
        return 1
    fi
    
    if ! is_running "$server_name"; then
        echo -e "${YELLOW}El servidor '$server_name' ya está apagado o inactivo.${NC}"
        return 0
    fi
    
    local pid
    pid=$(cat "$server_dir/server.pid")
    echo -e "${YELLOW}Deteniendo servidor '$server_name' (PID: $pid) enviando señal de apagado seguro...${NC}"
    kill -15 "$pid"
    
    # Esperar a que se apague de forma limpia
    local timeout=15
    local count=0
    while ps -p "$pid" > /dev/null && [ "$count" -lt "$timeout" ]; do
        sleep 1
        ((count++))
    done
    
    if ps -p "$pid" > /dev/null; then
        echo -e "${RED}El servidor no se detuvo en $timeout segundos. Forzando detención...${NC}"
        kill -9 "$pid"
    fi
    
    rm -f "$server_dir/server.pid"
    echo -e "${GREEN}Servidor '$server_name' detenido con éxito.${NC}"
}

# ------------------------------------------------------------------------------
# 6. Iniciar Servidor (Exclusivo / Auxiliar)
# ------------------------------------------------------------------------------
iniciar() {
    local server_name="$1"
    if [ -z "$server_name" ]; then
        server_name=$(select_server_interactive "Seleccione el servidor a iniciar:")
        [ $? -ne 0 ] && return 1
    fi
    
    iniciar_servidor "$server_name"
}

# ------------------------------------------------------------------------------
# 7. Reiniciar Servidor
# ------------------------------------------------------------------------------
reiniciar() {
    local server_name="$1"
    if [ -z "$server_name" ]; then
        server_name=$(select_server_interactive "Seleccione el servidor a reiniciar:")
        [ $? -ne 0 ] && return 1
    fi
    
    echo -e "${BLUE}=== Reiniciando Servidor: $server_name ===${NC}"
    detener "$server_name"
    sleep 2
    iniciar_servidor "$server_name"
}

# ------------------------------------------------------------------------------
# 8. Status Servidor
# ------------------------------------------------------------------------------
status() {
    # Listar servidores primero
    listar_servidor
    echo ""
    
    local server_name="$1"
    if [ -z "$server_name" ]; then
        server_name=$(select_server_interactive "Seleccione un servidor para ver los detalles y las últimas 10 líneas de log:")
        [ $? -ne 0 ] && return 0
    fi
    
    local server_dir="$SERVERS_DIR/$server_name"
    if [ ! -d "$server_dir" ]; then
        echo -e "${RED}Error: El servidor '$server_name' no existe.${NC}"
        return 1
    fi
    
    echo -e "\n${BLUE}=== Status Detallado de: $server_name ===${NC}"
    if is_running "$server_name"; then
        local pid
        pid=$(cat "$server_dir/server.pid")
        echo -e "Estado: ${GREEN}Activo (Corriendo)${NC}"
        echo -e "PID: $pid"
    else
        echo -e "Estado: ${RED}Inactivo (Detenido)${NC}"
    fi
    
    local version
    version=$(get_minecraft_version "$server_dir")
    echo -e "Versión: $version"
    
    # Buscar puerto
    local port="25565"
    if [ -f "$server_dir/server.properties" ]; then
        local prop_port
        prop_port=$(grep "^server-port=" "$server_dir/server.properties" | cut -d'=' -f2)
        [ -n "$prop_port" ] && port="$prop_port"
    fi
    echo -e "Puerto Configurado: $port"
    
    # Mostrar logs
    local log_file=""
    if [ -f "$server_dir/logs/latest.log" ]; then
        log_file="$server_dir/logs/latest.log"
    elif [ -f "$server_dir/stdout.log" ]; then
        log_file="$server_dir/stdout.log"
    fi
    
    if [ -n "$log_file" ]; then
        echo -e "\n${YELLOW}Últimas 10 líneas de salida ($(basename "$log_file")):${NC}"
        tail -n 10 "$log_file"
    else
        echo -e "\n${YELLOW}No hay registros de salida disponibles (no se encontró stdout.log ni logs/latest.log).${NC}"
    fi
}

# ------------------------------------------------------------------------------
# 8.5. Enviar Comando (command)
# ------------------------------------------------------------------------------
enviar_comando() {
    local server_name=""
    local command_str=""
    
    # Si se pasan 2 argumentos: command <nombre_servidor> "<comando>"
    if [ $# -eq 2 ]; then
        server_name="$1"
        command_str="$2"
    # Si se pasa 1 argumento: command "<comando>"
    elif [ $# -eq 1 ]; then
        command_str="$1"
        # Buscar servidores activos
        local running_servers=()
        for d in "$SERVERS_DIR"/*; do
            if [ -d "$d" ]; then
                local name
                name=$(basename "$d")
                if is_running "$name"; then
                    running_servers+=("$name")
                fi
            fi
        done
        
        if [ ${#running_servers[@]} -eq 0 ]; then
            echo -e "${RED}Error: No hay ningún servidor activo para enviar comandos.${NC}"
            return 1
        elif [ ${#running_servers[@]} -eq 1 ]; then
            server_name="${running_servers[0]}"
            echo -e "${YELLOW}Enviando al único servidor activo: $server_name${NC}"
        else
            # Preguntar cuál servidor activo usar
            echo -e "${BLUE}Seleccione el servidor activo para ejecutar el comando:${NC}"
            select opt in "${running_servers[@]}"; do
                if [ -n "$opt" ]; then
                    server_name="$opt"
                    break
                else
                    echo -e "${RED}Selección inválida.${NC}"
                fi
            done
        fi
    else
        echo -e "${RED}Uso: $0 command [nombre_servidor] \"<comando>\"${NC}"
        return 1
    fi
    
    if [ -z "$server_name" ] || [ -z "$command_str" ]; then
        echo -e "${RED}Error: Nombre de servidor o comando vacío.${NC}"
        return 1
    fi
    
    if ! is_running "$server_name"; then
        echo -e "${RED}Error: El servidor '$server_name' no está activo.${NC}"
        return 1
    fi
    
    if command -v tmux >/dev/null 2>&1 && tmux has-session -t "mc-$server_name" 2>/dev/null; then
        echo -e "${GREEN}Enviando comando a '$server_name': ${CYAN}$command_str${NC}"
        tmux send-keys -t "mc-$server_name" "$command_str" Enter
    else
        echo -e "${RED}Error: El servidor no está corriendo bajo una sesión de tmux activa.${NC}"
        return 1
    fi
}

# ------------------------------------------------------------------------------
# 9. Healthcheck
# ------------------------------------------------------------------------------
healthcheck() {
    echo "OK: El script de comandos funciona correctamente desde terminal"
}

# ------------------------------------------------------------------------------
# Despachador de funciones y Menú Principal
# ------------------------------------------------------------------------------

# Mapear nombres alternativos en minúsculas y con guiones bajos
func_arg="$1"
if [ -n "$func_arg" ]; then
    # Convertir a minúsculas y reemplazar guiones con guiones bajos
    func_name=$(echo "$func_arg" | tr '[:upper:]' '[:lower:]' | tr '-' '_')
    
    # Permitir alias comunes y mapeos especiales
    if [ "$func_name" = "listar_servidores" ]; then
        func_name="listar_servidor"
    elif [ "$func_name" = "command" ]; then
        func_name="enviar_comando"
    fi
    
    if declare -f "$func_name" > /dev/null; then
        shift
        "$func_name" "$@"
    else
        echo -e "${RED}Error: La función '$func_arg' no existe o no es válida.${NC}"
        echo "Funciones disponibles: crear_servidor, administrar_servidor, listar_servidor, borrar_servidor, iniciar, detener, reiniciar, status, command, healthcheck"
        exit 1
    fi
else
    # Si se ejecuta sin parámetros, mostrar el panel de control interactivo
    while true; do
        echo -e "\n${BLUE}=========================================${NC}"
        echo -e "${BLUE}=== Stuip-id Minecraft Server Control ===${NC}"
        echo -e "${BLUE}=========================================${NC}"
        echo "1) Crear Servidor"
        echo "2) Administrar Servidor (server.properties)"
        echo "3) Listar Servidores"
        echo "4) Iniciar Servidor"
        echo "5) Detener Servidor"
        echo "6) Reiniciar Servidor"
        echo "7) Status de Servidor (Detalles y logs)"
        echo "8) Borrar Servidor"
        echo "9) Enviar comando de consola"
        echo "10) Healthcheck"
        echo "11) Salir"
        echo -e "${BLUE}=========================================${NC}"
        read -rp "Seleccione una opción: " main_opt
        
        case "$main_opt" in
            1) crear_servidor ;;
            2) administrar_servidor ;;
            3) listar_servidor ;;
            4) iniciar ;;
            5) detener ;;
            6) reiniciar ;;
            7) status ;;
            8) borrar_servidor ;;
            9) 
                read -rp "Ingrese el comando de Minecraft (ej: op SirYorch): " cmd_input
                if [ -n "$cmd_input" ]; then
                    enviar_comando "$cmd_input"
                fi
                ;;
            10) healthcheck ;;
            11) echo -e "${GREEN}¡Saliendo!${NC}"; break ;;
            *) echo -e "${RED}Opción no válida.${NC}" ;;
        esac
    done
fi
