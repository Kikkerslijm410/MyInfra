import os
from flask import Flask

def create_app():
    app = Flask(__name__)

    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    app.config["DATA_FILE"] = os.environ.get(
        "DATA_FILE", os.path.join(base_dir, "data", "data.json")
    )
    app.config["UPLOAD_FOLDER"] = os.path.join(app.static_folder, "uploads")
    app.config["MAX_CONTENT_LENGTH"] = 5242880 # 5 MB

    os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)

    from .routes import bp as main_bp
    app.register_blueprint(main_bp)

    return app
