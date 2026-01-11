@echo off
setlocal

:: ============================================================================
:: INICIADOR DEL MOTOR DE IA PARA AJUSTES CONTABLES (V2.1 - Syntax Fix)
:: Este script automatiza la creación del entorno virtual y la instalación
:: de dependencias para el microservicio de Python.
:: ============================================================================

echo Iniciando Motor de IA para Ajustes Contables...
echo.

:: --- 1. Definir rutas ---
set "VENV_DIR=%~dp0.venv"
set "PYTHON_EXE=%VENV_DIR%\Scripts\python.exe"
set "REQUIREMENTS_FILE=%~dp0requirements.txt"

:: --- 2. Verificar si el entorno virtual (.venv) existe ---
if not exist "%PYTHON_EXE%" (
    echo Entorno virtual no encontrado. Creando uno nuevo...
    
    :: Intenta encontrar un ejecutable de Python en el PATH
    where python >nul 2>nul
    if %errorlevel% neq 0 (
        echo.
        echo ERROR: 'python' no se encuentra en el PATH del sistema.
        echo Por favor, instala Python 3.8 o superior y asegurate de que este en el PATH.
        pause
        exit /b 1
    )
    
    python -m venv "%VENV_DIR%"
    if %errorlevel% neq 0 (
        echo.
        echo ERROR: No se pudo crear el entorno virtual.
        pause
        exit /b 1
    )
    echo Entorno virtual creado exitosamente.
    echo.
)

:: --- 3. Activar el entorno virtual ---
call "%VENV_DIR%\Scripts\activate.bat"

:: --- 4. Verificar e instalar/actualizar dependencias ---
if not exist "%REQUIREMENTS_FILE%" (
    echo ERROR: El archivo 'requirements.txt' no se encuentra.
    pause
    exit /b 1
)

echo Verificando e instalando dependencias... esto puede tardar un momento...
"%PYTHON_EXE%" -m pip install --upgrade pip >nul
"%PYTHON_EXE%" -m pip install -r "%REQUIREMENTS_FILE%"
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Falla al instalar las dependencias de Python.
    echo Revisa tu conexion a internet o el archivo requirements.txt.
    pause
    exit /b 1
)
echo Dependencias verificadas.
echo.

:: --- 5. Iniciar el servidor de IA ---
echo ============================================================================
echo Iniciando motor de IA en http://localhost:8003
echo Presiona Ctrl+C para detener el servidor.
echo ============================================================================
echo.

"%PYTHON_EXE%" "%~dp0ai_adjustment_engine.py"

pause
endlocal
