import os
import json
import re

import numpy as np
import pandas as pd
import plotly.express as px
from flask import Flask, request, jsonify, render_template
from dotenv import load_dotenv
from werkzeug.utils import secure_filename

load_dotenv()

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 1000 * 1024 * 1024  # 1000 MB

UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

ALLOWED_EXTENSIONS = {"csv", "xlsx", "xls"}

# ---------------------------------------------------------------------------
# Global state – keeps the most recently uploaded DataFrame in memory.
# For a multi-user production app you'd use a session store / cache instead.
# ---------------------------------------------------------------------------
current_df: pd.DataFrame | None = None
current_filename: str | None = None


# ---------------------------------------------------------------------------
# CORS – allow any origin so the frontend can call the API freely.
# ---------------------------------------------------------------------------
@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type,Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET,POST,PUT,DELETE,OPTIONS"
    return response


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def _sanitize_for_json(obj):
    """Replace NaN / NaT / Infinity with None so json.dumps won't choke."""
    if isinstance(obj, dict):
        return {k: _sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_for_json(v) for v in obj]
    if isinstance(obj, float) and (np.isnan(obj) or np.isinf(obj)):
        return None
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        if np.isnan(obj) or np.isinf(obj):
            return None
        return float(obj)
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    if isinstance(obj, (np.ndarray,)):
        return _sanitize_for_json(obj.tolist())
    if pd.isna(obj):
        return None
    return obj


def _compute_stats(df: pd.DataFrame) -> dict:
    """Return per-column statistics dict."""
    stats: dict = {}
    total_rows = len(df)

    for col in df.columns:
        col_stats: dict = {
            "missing_count": int(df[col].isna().sum()),
            "missing_percentage": round(float(df[col].isna().sum()) / total_rows * 100, 2) if total_rows else 0.0,
        }

        if pd.api.types.is_numeric_dtype(df[col]):
            desc = df[col].describe()
            col_stats.update(
                {
                    "count": int(desc.get("count", 0)),
                    "mean": _sanitize_for_json(desc.get("mean")),
                    "std": _sanitize_for_json(desc.get("std")),
                    "min": _sanitize_for_json(desc.get("min")),
                    "max": _sanitize_for_json(desc.get("max")),
                    "median": _sanitize_for_json(float(df[col].median())),
                }
            )

        stats[col] = col_stats

    return stats


def _get_numeric_columns(df: pd.DataFrame) -> list[str]:
    return [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]


def _get_categorical_columns(df: pd.DataFrame, max_unique: int = 20) -> list[str]:
    return [
        c
        for c in df.columns
        if df[c].dtype.name in ("object", "category", "bool") and df[c].nunique() < max_unique
    ]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


# ---- Upload --------------------------------------------------------------

@app.route("/upload", methods=["POST"])
def upload():
    global current_df, current_filename

    if "file" not in request.files:
        return jsonify({"error": "No file part in the request."}), 400

    file = request.files["file"]
    if file.filename == "" or file.filename is None:
        return jsonify({"error": "No file selected."}), 400

    if not _allowed_file(file.filename):
        return jsonify({"error": f"Unsupported file type. Allowed: {', '.join(ALLOWED_EXTENSIONS)}"}), 400

    try:
        filename = secure_filename(file.filename)
        filepath = os.path.join(UPLOAD_FOLDER, filename)
        file.save(filepath)

        ext = filename.rsplit(".", 1)[1].lower()
        if ext == "csv":
            df = pd.read_csv(filepath)
        else:
            df = pd.read_excel(filepath)

        current_df = df
        current_filename = filename

        preview = df.head(10).to_dict(orient="records")
        preview = _sanitize_for_json(preview)

        dtypes = {col: str(dtype) for col, dtype in df.dtypes.items()}
        stats = _sanitize_for_json(_compute_stats(df))

        return jsonify(
            {
                "filename": file.filename,
                "rows": len(df),
                "columns": list(df.columns),
                "dtypes": dtypes,
                "preview": preview,
                "stats": stats,
                "shape": [int(df.shape[0]), int(df.shape[1])],
            }
        )

    except Exception as exc:
        return jsonify({"error": f"Failed to process file: {str(exc)}"}), 500


# ---- Manual Visualize -----------------------------------------------------

@app.route("/visualize", methods=["POST"])
def visualize():
    global current_df

    if current_df is None:
        return jsonify({"error": "No dataset uploaded yet."}), 400

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Invalid or missing JSON body."}), 400

    chart_type = data.get("chart_type", "bar").lower()
    x_column = data.get("x_column")
    y_column = data.get("y_column")

    if not x_column:
        return jsonify({"error": "'x_column' is required."}), 400

    if x_column not in current_df.columns:
        return jsonify({"error": f"Column '{x_column}' not found in dataset."}), 400

    if y_column and y_column not in current_df.columns:
        return jsonify({"error": f"Column '{y_column}' not found in dataset."}), 400

    try:
        fig = _build_chart(current_df, chart_type, x_column, y_column)
        return jsonify({"chart_json": fig.to_json()})
    except Exception as exc:
        return jsonify({"error": f"Chart generation failed: {str(exc)}"}), 500


def _build_chart(df: pd.DataFrame, chart_type: str, x_column: str, y_column: str | None = None, title: str | None = None):
    """Create and return a Plotly figure."""
    chart_title = title or f"{chart_type.title()} Chart"

    if chart_type == "bar":
        if y_column:
            fig = px.bar(df, x=x_column, y=y_column, title=chart_title)
        else:
            counts = df[x_column].value_counts().reset_index()
            counts.columns = [x_column, "count"]
            fig = px.bar(counts, x=x_column, y="count", title=chart_title)

    elif chart_type == "line":
        if y_column:
            fig = px.line(df, x=x_column, y=y_column, title=chart_title)
        else:
            fig = px.line(df, y=x_column, title=chart_title)

    elif chart_type == "scatter":
        if y_column:
            fig = px.scatter(df, x=x_column, y=y_column, title=chart_title)
        else:
            fig = px.scatter(df, y=x_column, title=chart_title)

    elif chart_type == "pie":
        if y_column:
            fig = px.pie(df, names=x_column, values=y_column, title=chart_title)
        else:
            counts = df[x_column].value_counts().reset_index()
            counts.columns = [x_column, "count"]
            fig = px.pie(counts, names=x_column, values="count", title=chart_title)

    elif chart_type == "histogram":
        fig = px.histogram(df, x=x_column, title=chart_title)

    elif chart_type == "box":
        if y_column:
            fig = px.box(df, x=x_column, y=y_column, title=chart_title)
        else:
            fig = px.box(df, y=x_column, title=chart_title)

    else:
        raise ValueError(f"Unsupported chart type: {chart_type}")

    fig.update_layout(template="plotly_white")
    return fig


# ---- Auto Visualize -------------------------------------------------------

@app.route("/auto-visualize", methods=["POST"])
def auto_visualize():
    global current_df

    if current_df is None:
        return jsonify({"error": "No dataset uploaded yet."}), 400

    try:
        charts: list[dict] = []
        numeric_cols = _get_numeric_columns(current_df)
        categorical_cols = _get_categorical_columns(current_df)

        # 1. Scatter of first two numeric columns
        if len(numeric_cols) >= 2:
            x_col, y_col = numeric_cols[0], numeric_cols[1]
            fig = px.scatter(
                current_df, x=x_col, y=y_col,
                title=f"Scatter: {x_col} vs {y_col}",
            )
            fig.update_layout(template="plotly_white")
            charts.append(
                {
                    "title": f"Scatter: {x_col} vs {y_col}",
                    "chart_json": fig.to_json(),
                    "description": f"Scatter plot showing the relationship between {x_col} and {y_col}.",
                }
            )

        # 2. Bar chart – mean of first numeric grouped by first categorical
        if categorical_cols and numeric_cols:
            cat_col = categorical_cols[0]
            num_col = numeric_cols[0]
            grouped = (
                current_df.groupby(cat_col)[num_col]
                .mean()
                .reset_index()
                .rename(columns={num_col: f"mean_{num_col}"})
            )
            fig = px.bar(
                grouped, x=cat_col, y=f"mean_{num_col}",
                title=f"Mean {num_col} by {cat_col}",
            )
            fig.update_layout(template="plotly_white")
            charts.append(
                {
                    "title": f"Mean {num_col} by {cat_col}",
                    "chart_json": fig.to_json(),
                    "description": f"Bar chart of the average {num_col} for each category in {cat_col}.",
                }
            )

        # 3. Histogram of first numeric column
        if numeric_cols:
            col = numeric_cols[0]
            fig = px.histogram(current_df, x=col, title=f"Distribution of {col}")
            fig.update_layout(template="plotly_white")
            charts.append(
                {
                    "title": f"Distribution of {col}",
                    "chart_json": fig.to_json(),
                    "description": f"Histogram showing the distribution of values in {col}.",
                }
            )

        # 4. Pie chart of a categorical column with <= 10 unique values
        pie_col = next((c for c in categorical_cols if current_df[c].nunique() <= 10), None)
        if pie_col is not None:
            counts = current_df[pie_col].value_counts().reset_index()
            counts.columns = [pie_col, "count"]
            fig = px.pie(counts, names=pie_col, values="count", title=f"Proportion of {pie_col}")
            fig.update_layout(template="plotly_white")
            charts.append(
                {
                    "title": f"Proportion of {pie_col}",
                    "chart_json": fig.to_json(),
                    "description": f"Pie chart showing the proportion of each category in {pie_col}.",
                }
            )

        return jsonify(charts)

    except Exception as exc:
        return jsonify({"error": f"Auto-visualization failed: {str(exc)}"}), 500


# ---- AI Ask (Gemini) -------------------------------------------------------

@app.route("/ask", methods=["POST"])
def ask():
    global current_df

    if current_df is None:
        return jsonify({"error": "No dataset uploaded yet."}), 400

    data = request.get_json(silent=True)
    if not data or not data.get("question"):
        return jsonify({"error": "'question' is required."}), 400

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return (
            jsonify(
                {
                    "error": (
                        "Gemini API key is not configured. "
                        "Set the GEMINI_API_KEY environment variable in your .env file."
                    )
                }
            ),
            500,
        )

    question = data["question"]

    try:
        import google.generativeai as genai

        genai.configure(api_key=api_key)

        # Build context about the dataset
        describe_str = current_df.describe(include="all").to_string()
        head_str = current_df.head(5).to_string()
        dtypes_str = "\n".join(f"  {col}: {dtype}" for col, dtype in current_df.dtypes.items())

        context = (
            f"Dataset shape: {current_df.shape[0]} rows × {current_df.shape[1]} columns\n\n"
            f"Columns and data types:\n{dtypes_str}\n\n"
            f"Statistical summary:\n{describe_str}\n\n"
            f"First 5 rows:\n{head_str}"
        )

        system_prompt = (
            "You are a data analysis assistant. You are given a dataset's metadata and a user question. "
            "Answer the question based on the data. Be concise and insightful.\n"
            "If the question asks for a visualization, respond with a JSON block containing:\n"
            '{"chart": {"chart_type": "bar|line|scatter|pie|histogram|box", '
            '"x_column": "col_name", "y_column": "col_name", "title": "Chart Title"}}\n'
            "Include this JSON block within your text response wrapped in ```json ``` code fences.\n"
            "Always provide textual analysis along with any chart suggestion."
        )

        model = genai.GenerativeModel(
            model_name="gemini-2.0-flash",
            system_instruction=system_prompt,
        )

        prompt = f"Here is the dataset information:\n\n{context}\n\nUser question: {question}"
        response = model.generate_content(prompt)
        answer_text = response.text

        # Try to extract a ```json``` block with chart instructions
        chart_json_str = None
        json_match = re.search(r"```json\s*(\{.*?\})\s*```", answer_text, re.DOTALL)
        if json_match:
            try:
                chart_spec = json.loads(json_match.group(1))
                if "chart" in chart_spec:
                    c = chart_spec["chart"]
                    fig = _build_chart(
                        current_df,
                        chart_type=c.get("chart_type", "bar"),
                        x_column=c.get("x_column", current_df.columns[0]),
                        y_column=c.get("y_column"),
                        title=c.get("title"),
                    )
                    chart_json_str = fig.to_json()
            except (json.JSONDecodeError, ValueError, KeyError):
                pass  # Couldn't parse chart spec – just return the text answer

        return jsonify({"answer": answer_text, "chart_json": chart_json_str})

    except Exception as exc:
        err_msg = str(exc)
        if "API_KEY_INVALID" in err_msg or "API key not valid" in err_msg:
            return jsonify({"error": "Invalid API key. Please update your API key in the configuration.", "key_error": True}), 400
        return jsonify({"error": f"AI query failed: {err_msg}"}), 500


@app.route("/set-api-key", methods=["POST"])
def set_api_key():
    data = request.get_json(silent=True)
    if not data or not data.get("api_key"):
        return jsonify({"error": "API key is required."}), 400
    
    new_key = data["api_key"].strip()
    try:
        env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
        lines = []
        key_exists = False
        
        if os.path.exists(env_path):
            with open(env_path, "r") as f:
                lines = f.readlines()
            
            for i, line in enumerate(lines):
                if line.startswith("GEMINI_API_KEY="):
                    lines[i] = f"GEMINI_API_KEY={new_key}\n"
                    key_exists = True
                    break
        
        if not key_exists:
            lines.append(f"GEMINI_API_KEY={new_key}\n")
            
        with open(env_path, "w") as f:
            f.writelines(lines)
            
        os.environ["GEMINI_API_KEY"] = new_key
        return jsonify({"success": True, "message": "API key updated successfully!"})
    except Exception as exc:
        return jsonify({"error": f"Failed to save API key: {str(exc)}"}), 500


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
