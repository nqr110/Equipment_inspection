from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit
import json
import uuid
from datetime import datetime
import os
import re
# safe_str_cmp已被移除，改用直接字符串比较
from werkzeug.security import check_password_hash, generate_password_hash  # 保留其他安全相关导入

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('FLASK_SECRET_KEY', 'fallback-secret-key-needs-to-be-changed')
socketio = SocketIO(app, cors_allowed_origins="*")

# 数据文件路径
DATA_FILE = 'inspection_data.json'

# 验证检查项数据
def validate_inspection_item(item):
    if not isinstance(item, dict):
        return False
    required_fields = ['id', 'name', 'status', 'completed_by', 'completed_at']
    if not all(field in item for field in required_fields):
        return False
    if not re.match(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$', item['id']):
        return False
    if not isinstance(item['name'], str) or len(item['name']) > 100:
        return False
    if item['status'] not in ['pending', 'completed']:
        return False
    return True

# 加载检查单数据
def load_inspection_data():
    try:
        with open(DATA_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            # 验证数据完整性
            if not isinstance(data, dict) or 'items' not in data:
                raise ValueError("Invalid data format")
            
            # 确保所有检查项的状态都被重置为 'pending'，并清空完成人和完成时间
            valid_items = []
            for item in data['items']:
                if validate_inspection_item(item):
                    item['status'] = 'pending'
                    item['completed_by'] = ''
                    item['completed_at'] = ''
                    valid_items.append(item)
            
            data['items'] = valid_items
            return data
    except (FileNotFoundError, json.JSONDecodeError, ValueError):
        # 如果文件不存在或数据无效，返回默认数据
        return {
            'items': [
                {'id': str(uuid.uuid4()), 'name': '设备外观检查', 'status': 'pending', 'completed_by': '', 'completed_at': ''},
                {'id': str(uuid.uuid4()), 'name': '电源连接检查', 'status': 'pending', 'completed_by': '', 'completed_at': ''},
                {'id': str(uuid.uuid4()), 'name': '安全装置检查', 'status': 'pending', 'completed_by': '', 'completed_at': ''},
                {'id': str(uuid.uuid4()), 'name': '运行状态检查', 'status': 'pending', 'completed_by': '', 'completed_at': ''},
                {'id': str(uuid.uuid4()), 'name': '清洁度检查', 'status': 'pending', 'completed_by': '', 'completed_at': ''}
            ],
            'overall_status': 'in_progress',
            'created_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'updated_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        }

# 保存检查单数据
def save_inspection_data():
    try:
        with open(DATA_FILE, 'w', encoding='utf-8') as f:
            json.dump(inspection_data, f, ensure_ascii=False, indent=4)
    except Exception as e:
        print(f"保存数据失败: {e}")

# 存储检查单数据
inspection_data = load_inspection_data()

# 存储连接的用户
connected_users = {}

# WebSocket连接事件
@socketio.on('connect', namespace='/inspection')
def handle_connect():
    print('Client connected')
    # 发送当前检查单状态给新连接的客户端
    emit('inspection_update', {'type': 'full_update', 'payload': inspection_data})

# WebSocket消息处理
@socketio.on('inspection_update', namespace='/inspection')
def handle_inspection_update(data):
    if data.get('type') == 'sync_local_changes':
        # 处理本地同步数据
        inspection_data.update(data.get('payload', {}))
        save_inspection_data()
        broadcast_inspection_update()
    elif data.get('type') == 'add_item':
        # 处理添加项目请求
        new_item = {
            'id': str(uuid.uuid4()),
            'name': data.get('payload', {}).get('name', ''),
            'status': 'pending', 
            'completed_by': '',
            'completed_at': ''
        }
        inspection_data['items'].append(new_item)
        inspection_data['updated_at'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        save_inspection_data()
        broadcast_inspection_update()
    elif data.get('type') == 'update_status':
        # 处理状态更新请求
        item_id = data.get('payload', {}).get('item_id')
        status = data.get('payload', {}).get('status')
        user_id = data.get('payload', {}).get('user_id', 'Anonymous')
        
        for item in inspection_data['items']:
            if item['id'] == item_id:
                item['status'] = status
                if status == 'completed':
                    item['completed_by'] = user_id
                    item['completed_at'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                else:
                    item['completed_by'] = ''
                    item['completed_at'] = ''
                break
        
        inspection_data['updated_at'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        save_inspection_data()
        broadcast_inspection_update()

# 广播检查单更新
def broadcast_inspection_update():
    socketio.emit('inspection_update', {
        'type': 'full_update',
        'payload': inspection_data
    }, namespace='/inspection')

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/overview')
def overview():
    return render_template('overview.html')

@app.route('/api/inspection', methods=['GET'])
def get_inspection():
    return jsonify(inspection_data)

def sanitize_input(text):
    """清理输入文本，移除潜在的恶意内容"""
    if not isinstance(text, str):
        return ''
    # 移除HTML标签
    text = re.sub(r'<[^>]*>', '', text)
    # 移除特殊字符
    text = re.sub(r'[\\/*?<>|\'"]', '', text)
    return text.strip()

@app.route('/api/inspection/item', methods=['POST'])
def add_item():
    if not request.json or 'name' not in request.json:
        return jsonify({'success': False, 'error': 'Invalid request'}), 400
    
    name = sanitize_input(request.json['name'])
    if not name or len(name) > 100:
        return jsonify({'success': False, 'error': 'Invalid item name'}), 400
    
    new_item = {
        'id': str(uuid.uuid4()),
        'name': name,
        'status': 'pending',
        'completed_by': '',
        'completed_at': ''
    }
    inspection_data['items'].append(new_item)
    inspection_data['updated_at'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    
    # 保存数据到文件
    save_inspection_data()
    
    # 广播更新
    broadcast_inspection_update()
    
    return jsonify({'success': True, 'item': new_item, 'data': inspection_data})

@app.route('/api/inspection/item/<item_id>', methods=['DELETE'])
def delete_item(item_id):
    if not re.match(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$', item_id):
        return jsonify({'success': False, 'error': 'Invalid item ID'}), 400
    
    original_count = len(inspection_data['items'])
    inspection_data['items'] = [item for item in inspection_data['items'] if item['id'] != item_id]
    
    if len(inspection_data['items']) == original_count:
        return jsonify({'success': False, 'error': 'Item not found'}), 404
    
    inspection_data['updated_at'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    
    # 保存数据到文件
    save_inspection_data()
    
    # 广播更新
    broadcast_inspection_update()
    
    return jsonify({'success': True, 'data': inspection_data})

@app.route('/api/inspection/item/<item_id>/status', methods=['PUT'])
def update_item_status(item_id):
    if not re.match(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$', item_id):
        return jsonify({'success': False, 'error': 'Invalid item ID'}), 400
    
    if not request.json or 'status' not in request.json:
        return jsonify({'success': False, 'error': 'Invalid request'}), 400
    
    status = request.json['status']
    if status not in ['pending', 'completed']:
        return jsonify({'success': False, 'error': 'Invalid status'}), 400
    
    user_id = sanitize_input(request.json.get('user_id', 'Anonymous'))
    
    item_found = False
    for item in inspection_data['items']:
        if item['id'] == item_id:
            item_found = True
            item['status'] = status
            if status == 'completed':
                item['completed_by'] = user_id
                item['completed_at'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            else:
                item['completed_by'] = ''
                item['completed_at'] = ''
            break
    
    if not item_found:
        return jsonify({'success': False, 'error': 'Item not found'}), 404
    
    # 检查整体状态
    completed_items = [item for item in inspection_data['items'] if item['status'] == 'completed']
    total_items = len(inspection_data['items'])
    
    if len(completed_items) == total_items:
        inspection_data['overall_status'] = 'completed'
    else:
        inspection_data['overall_status'] = 'in_progress'
    
    inspection_data['updated_at'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    
    # 保存数据到文件
    save_inspection_data()
    
    # 广播更新
    broadcast_inspection_update()
    
    return jsonify({'success': True, 'data': inspection_data})

if __name__ == '__main__':
    # 启动主应用在4999端口
    socketio.run(app, host='127.0.0.1', port=4999, debug=True)
    
