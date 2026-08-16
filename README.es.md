# DeferredDeployments

*[English](README.md)*

Los despliegues a `main` son **programados, no inmediatos**. Cada pull request genera una
*incidencia de solicitud de despliegue* que recoge cuándo debe publicarse el cambio y qué
contiene. El despliegue se ejecuta en esa fecha, con una aprobación que depende de quién deba
autorizarlo.

| Fecha solicitada (Europe/Madrid) | Entorno              | Aprobación                       |
| -------------------------------- | -------------------- | -------------------------------- |
| Sábado o domingo                 | `production-weekend` | Propietario del repositorio      |
| De lunes a viernes               | `production`         | Ninguna — se ejecuta sin vigilancia |

## Cómo funciona

```mermaid
flowchart TD
    A[PR abierta contra main] --> B[Comentario fijo en la PR con el enlace<br/>al formulario prerrellenado]
    B --> C[deployment-request/validated falla<br/>la fusión queda bloqueada]
    C --> D[El autor envía el formulario]
    D --> E{¿Completa y fecha válida?}
    E -- No --> F[La comprobación sigue en rojo<br/>la incidencia indica qué falta]
    F --> G[El autor edita la incidencia]
    G --> E
    E -- Sí --> H[El estado pasa a verde<br/>etiqueta deploy-weekend o deploy-weekday]
    H --> I[PR fusionada<br/>se registra el SHA del commit de fusión]
    I --> J[El sondeo diario revisa las solicitudes abiertas]
    J --> K{¿La fecha solicitada es hoy?}
    K -- No --> J
    K -- Sí --> L{¿Fin de semana?}
    L -- Sí --> M[production-weekend<br/>espera la aprobación del propietario]
    L -- No --> N[production<br/>sin barrera]
    M --> O[Se descarga y despliega el commit aprobado]
    N --> O
    O --> P[Se comenta la incidencia, se etiqueta deployed y se cierra]
```

1. **Se abre una PR contra `main`.** `pr-deployment-request.yml` publica un comentario fijo en
   la PR con un enlace destacado al formulario de solicitud de despliegue, con el número de la
   PR ya rellenado. La comprobación en rojo también apunta al formulario, de modo que *Details*
   lleva directamente allí. Es lo más parecido a «redirigir al formulario» que GitHub permite
   — véase [Limitaciones](#limitaciones).
2. **La fusión queda bloqueada hasta que la solicitud exista y esté completa.** El estado de
   commit `deployment-request/validated` falla mientras no haya solicitud, o mientras le falte
   una fecha futura válida, un resumen o un plan de reversión.
3. **La validación se ejecuta al enviar el formulario y en cada edición.**
   `validate-deployment-request.yml` analiza la incidencia, la vincula a la PR con la etiqueta
   `pr-<número>`, aplica `deploy-weekend` o `deploy-weekday` y pone el estado en verde sin
   necesidad de un nuevo push.
4. **Al fusionar se registra el SHA del commit de fusión** como comentario en la incidencia.
   Ese es exactamente el commit que se desplegará más adelante. Si la solicitud se había cerrado
   antes de desplegarse, aquí se reabre.
5. **Un sondeo diario ejecuta el despliegue.** `scheduled-deploy.yml` recoge las solicitudes
   fusionadas y validadas cuya fecha sea hoy y llama a `deploy.yml` con el entorno
   correspondiente. Los despliegues de fin de semana se detienen a la espera de aprobación;
   los de días laborables continúan.

## Estructura del repositorio

| Ruta                                              | Propósito                                                        |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| `.github/ISSUE_TEMPLATE/deployment-request.yml`    | El formulario de solicitud de despliegue.                        |
| `.github/scripts/deployment-issue.js`              | Análisis de la incidencia, validación de fechas y regla de fin de semana. |
| `.github/scripts/deployment-issue.test.js`         | Pruebas unitarias de lo anterior.                                |
| `.github/workflows/pr-deployment-request.yml`      | Publica el comentario fijo, fija el estado y registra el SHA de fusión. |
| `.github/workflows/validate-deployment-request.yml` | Revalida al editar, etiqueta y elimina duplicados.              |
| `.github/workflows/scheduled-deploy.yml`           | Sondeo diario que localiza los despliegues previstos para hoy.   |
| `.github/workflows/deploy.yml`                     | Trabajo de despliegue reutilizable con la barrera dinámica.      |
| `.github/workflows/tests.yml`                      | Ejecuta las pruebas unitarias.                                   |
| `.github/ruleset.json`                             | Definición del ruleset de `main`, aplicada con la CLI de GitHub. |

### `deployment-issue.js`

Este módulo es la única fuente de verdad de la lógica de programación: los tres flujos de
automatización lo importan, de modo que la regla de fin de semana no puede divergir entre ellos.

| Exportación       | Comportamiento                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `parseIssue`      | Convierte el cuerpo del formulario en un mapa de campos, tratando `_No response_` como vacío. |
| `renderBody`      | Genera un cuerpo con los mismos encabezados, para las incidencias creadas automáticamente.   |
| `todayInTz`       | La fecha de hoy en `Europe/Madrid`.                                                          |
| `classify`        | Valida una fecha y devuelve `isWeekend`, el entorno de destino y la etiqueta.                |
| `validateRequest` | Comprobación completa de una solicitud; devuelve todos los problemas a la vez.               |

Una fecha se rechaza si no tiene el formato `YYYY-MM-DD`, si no es una fecha real del
calendario (`2026-02-31`) o si está en el pasado.

### Campos del formulario

| Id del campo  | Etiqueta                         | Obligatorio |
| ------------- | -------------------------------- | ----------- |
| `pr`          | Pull Request number              | Sí          |
| `deploy_date` | Deployment date (YYYY-MM-DD)     | Sí          |
| `summary`     | What is being deployed?          | Sí          |
| `risk`        | Risk level (low / medium / high) | Sí          |
| `rollback`    | Rollback plan                    | Sí          |

### Etiquetas

Las etiquetas se crean automáticamente la primera vez que se aplican.

| Etiqueta             | Significado                                                              |
| -------------------- | ------------------------------------------------------------------------ |
| `deployment-request` | Identifica la incidencia como solicitud de despliegue. Activa todo el flujo. |
| `pending-details`    | La solicitud está incompleta; la fusión está bloqueada.                  |
| `pr-<número>`        | Vincula la incidencia con su pull request.                               |
| `deploy-weekend`     | La fecha cae en sábado o domingo.                                        |
| `deploy-weekday`     | La fecha cae de lunes a viernes.                                         |
| `merged`             | La PR está fusionada y el SHA del commit está registrado.                |
| `deployed`           | El despliegue tuvo éxito; la incidencia se cierra.                       |
| `deployment-failed`  | El despliegue se ejecutó pero falló.                                     |

## Configuración inicial

Estos pasos no se pueden configurar desde el código y deben realizarse en los ajustes del
repositorio.

**Entornos** — Settings → Environments:

- `production-weekend` — añádete como **revisor obligatorio**. Opcionalmente, restringe la
  rama de despliegue a `main`.
- `production` — créalo **sin** revisores.

**Conjunto de reglas (ruleset)** — la definición está en `.github/ruleset.json`. Aplícala con la
CLI de GitHub:

```bash
gh auth login
gh api --method POST repos/aiturralde/DeferredDeployments/rulesets --input .github/ruleset.json
```

Comprueba el resultado:

```bash
gh api repos/aiturralde/DeferredDeployments/rulesets --jq '.[] | "\(.id)  \(.name)  \(.enforcement)"'
```

Se aplica a la rama por defecto e impone: prohibido borrarla, prohibido el force push, una pull
request con una aprobación y la comprobación `deployment-request/validated`. Lo mismo puede
configurarse a mano en Settings → Rules → Rulesets.

El archivo es un registro de la configuración deseada, no un vínculo activo: GitHub no lo lee
desde el repositorio. Actualmente está aplicado como el ruleset
[`20913989`](https://github.com/aiturralde/DeferredDeployments/rules/20913989). Si lo editas,
vuelve a aplicarlo con:

```bash
gh api --method PUT repos/aiturralde/DeferredDeployments/rulesets/20913989 --input .github/ruleset.json
```

> Mientras no exista el conjunto de reglas, la solicitud de despliegue es solo informativa: la
> comprobación se publica, pero nada impide la fusión.

> El ruleset no tiene lista de excepciones, así que también afecta al propietario del
> repositorio. Como GitHub no permite aprobar tu propia pull request, **cada fusión a `main`
> necesita la aprobación de una segunda persona**. Para trabajar en solitario, pon
> `required_approving_review_count` a `0` y vuelve a aplicar el ruleset, o añade *Repository
> admin* a la **Bypass list** desde la interfaz web.

**Comandos de despliegue** — este repositorio es una **demo**: el paso `Deploy` de `deploy.yml`
solo escribe un aviso de éxito en el registro de la ejecución, no despliega nada. Para hacerlo
real, sustituye ese paso por los comandos correspondientes. El trabajo ya verifica que el commit
descargado coincide con el SHA registrado al fusionar, de modo que una fusión posterior a `main`
no puede alterar en silencio lo que se publica.

## Uso diario

**Como desarrollador:** abre tu PR, pulsa **Open the deployment request form** en el comentario
del bot, envíalo y fusiona cuando la comprobación pase a verde. Para reprogramar, edita la
incidencia: la validación se repite automáticamente.

**Como aprobador:** los despliegues de fin de semana aparecen como una revisión pendiente en la
ejecución del entorno `production-weekend` la mañana de la fecha solicitada. Apruébalos ahí.

Para probar sin esperar a la programación, ejecuta **Scheduled deployment** manualmente desde
la pestaña Actions. Marca `dry_run` para listar lo que está previsto sin desplegar nada.

## Personalización

- **Zona horaria o días de fin de semana** — modifica `TZ` o la comprobación del día de la
  semana en `classify`.
- **Festivos** — amplía `classify` para consultar una lista de festivos y devolver también el
  entorno de fin de semana en esas fechas.
- **Una barrera real entre semana** — crea un equipo `deploy-approvers` y añádelo como revisor
  obligatorio del entorno `production`. No hace falta cambiar ningún flujo de trabajo.
- **Hora del despliegue** — ajusta el `cron` de `scheduled-deploy.yml`. Está en UTC.

## Resolución de problemas

| Síntoma                                              | Causa                                                                                    |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| La comprobación sigue en rojo tras corregir la incidencia | El campo `pr` no corresponde a un número de PR real, así que el estado no puede publicarse. |
| No aparece ninguna incidencia ni comentario en la PR  | La PR procede de un fork, que solo recibe un token de solo lectura.                       |
| Se omite un despliegue previsto                       | La incidencia no tiene un SHA de fusión registrado: la PR no se fusionó, o se fusionó antes de existir estos flujos. |
| La ejecución programada no arranca                    | El cron de GitHub no garantiza la hora y puede retrasarse; los flujos programados se desactivan tras 60 días de inactividad. |
| Existen dos incidencias para una misma PR             | Es lo esperado si también se rellenó el formulario a mano. La más reciente se cierra como duplicada automáticamente. |

## Limitaciones

- **Nada puede redirigir el navegador tras crear la PR.** GitHub Actions no puede llevar al
  autor a ninguna página, así que tanto el comentario fijo como el enlace *Details* de la
  comprobación en rojo apuntan al formulario prerrellenado.
- **`@copilot` no puede aprobar un despliegue.** Los revisores obligatorios de un entorno deben
  ser usuarios o equipos con acceso al repositorio, y el agente de programación Copilot no es
  elegible. Por eso los despliegues entre semana no tienen barrera en lugar de ser aprobados
  por `@copilot`.
- **Los formularios de incidencia no tienen selector de fecha.** La fecha es un campo de texto
  validado por el flujo de trabajo.
- **Las PR desde forks no están cubiertas**, como se indica arriba.
- **Solo sábado y domingo** cuentan como días no laborables; los festivos no están modelados.
- **Las aprobaciones de entorno caducan** tras unos 30 días de espera.

## Pruebas

```bash
node --test .github/scripts/deployment-issue.test.js
```
