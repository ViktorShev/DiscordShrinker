import subprocess
import json
import math
import time
import sys


FILE_SIZE_LIMIT_IN_BYTES = 8388608 # 8 * 1024 * 1024

def get_file_path():

    return sys.argv[1]


def get_file_name():

    return sys.argv[1].split('\\')[-1]


def get_file_endings(file_name):
    file_names_dict = {
        'video_only': f'{file_name + "_NO_AUD.mp4"}',
        'audio_only': f'{file_name + "_NO_VID.mp4"}',
        'rescaled': f'{file_name + "_RESCALED.mp4"}',
        'changed_bitrate': f'{file_name + "_CHANGED_BITRATE.mp4"}',
        '8mb': '_8MB.mp4',
        'original': file_name
    }

    return file_names_dict


def check_file_size(video_data, audio_data):
    if int(video_data['format']['size']) + int(audio_data['format']['size']) < FILE_SIZE_LIMIT_IN_BYTES:
        print('\n\nFile is already under 8MB!')
        time.sleep(2)
        sys.exit(0)

def split_video(file_path, output):
    subprocess.run(f'.\\ffmpeg.exe -i "{file_path}" -y -c:v copy -an ".\\tmp\\{output["video_only"]}" -c:a copy -vn ".\\tmp\\{output["audio_only"]}"')


def get_data(file_name):
    stdout = subprocess.run(f'.\\ffprobe.exe -i ".\\tmp\\{file_name}" -v quiet -print_format json -show_streams -show_format', capture_output=True, encoding='UTF-8').stdout
    data_json = json.loads(stdout)

    return data_json


def rescale_video(file_name, output, video_data):
    if {video_data['streams'][0]['width'], video_data['streams'][0]['height']}.issubset({1920, 1080}):
        subprocess.run(f'.\\ffmpeg.exe -i ".\\tmp\\{file_name}" -y -s 1280x720 ".\\tmp\\{output}"')


def determine_target_bitrate(video_data, audio_data):
    reduction_coeff = int(video_data['format']['size']) / (FILE_SIZE_LIMIT_IN_BYTES - int(audio_data['format']['size']))
    target_bitrate = int(video_data['streams'][0]['bit_rate']) / math.ceil(reduction_coeff)

    return target_bitrate


def process_video(file_names, video_data, audio_data, bitrate, output, output_path):
    if not video_data: #JSON is empty = video was not rescaled (less than 1080p) -> Change bitrate instead of rescaling.
        subprocess.run(f'.\\ffmpeg.exe -i ".\\tmp\\{file_names["video_only"]}" -y -b:v {bitrate} ".\\tmp\\{file_names["changed_bitrate"]}"')
        subprocess.run(f'.\\ffmpeg.exe -i ".\\tmp\\{file_names["changed_bitrate"]}" -i ".\\tmp\\{file_names["audio_only"]}" -y -c copy "{output_path + output}"')
    elif video_data: #JSON isn't empty = video was rescaled -> Check if it's under 8mb -> If it isn't, change bitrate.
        if int(video_data['format']['size']) + int(audio_data['format']['size']) > FILE_SIZE_LIMIT_IN_BYTES:
            subprocess.run(f'.\\ffmpeg.exe -i ".\\tmp\\{file_names["video_only"]}" -y -b:v {bitrate} ".\\tmp\\{file_names["changed_bitrate"]}"')
            subprocess.run(f'.\\ffmpeg.exe -i ".\\tmp\\{file_names["changed_bitrate"]}" -i ".\\tmp\\{file_names["audio_only"]}" -y -c copy "{output_path + output}"')
        else:
            subprocess.run(f'.\\ffmpeg.exe -i ".\\tmp\\{file_names["rescaled"]}" -i ".\\tmp\\{file_names["audio_only"]}" -y -c copy "{output_path + output}"')


file_path = get_file_path()
file_name = get_file_name()
file_names = get_file_endings(file_name)
split_video(file_path, file_names)
video_data = get_data(file_names['video_only'])
audio_data = get_data(file_names['audio_only'])
check_file_size(video_data, audio_data)
rescale_video(file_names['video_only'], file_names['rescaled'], video_data)
rescaled_video_data = get_data(file_names['rescaled'])
bitrate = determine_target_bitrate(video_data, audio_data)
process_video(file_names, rescaled_video_data, audio_data, bitrate, file_names['8mb'], file_path)
